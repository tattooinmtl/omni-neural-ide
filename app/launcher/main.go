// OMNI-CODE native Win32 splash launcher — custom-painted, no browser, no white chrome.
// paintSplash leaves room for a future face-animation overlay above the controls.
package main

import (
	"embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/rodrigocfd/windigo/co"
	"github.com/rodrigocfd/windigo/ui"
	"github.com/rodrigocfd/windigo/win"
)

//go:embed embed/omni-logo.bmp
var logoFS embed.FS

const version = "1.0.3"

// Brand green (#00FF88) and navy matching the logo plate.
var colorGreen = win.RGB(0x00, 0xff, 0x88)
var colorGreenDim = win.RGB(0x00, 0xc0, 0x66)
var colorNavy = win.RGB(0x05, 0x0a, 0x15)
var colorPanel = win.RGB(0x06, 0x10, 0x18)
var colorBtnFill = win.RGB(0x08, 0x18, 0x12)
var colorBtnHover = win.RGB(0x0c, 0x2a, 0x1c)

type splashState struct {
	wnd        *ui.Main
	modeUltra  bool
	hover      int // 0 none, 1 plain, 2 ultra, 3 launch, 4 cancel
	bgBmp      win.HBITMAP
	bgW, bgH   int
	fontTitle  win.HFONT
	fontBody   win.HFONT
	resultOK   bool
	resultMode string
	install    string
	logf       *os.File
}

func main() {
	runtime.LockOSThread()
	install := installRoot()
	for _, d := range []string{"keys", "sandbox", "bin", "logs", "assets"} {
		_ = os.MkdirAll(filepath.Join(install, d), 0o755)
	}
	logPath := filepath.Join(install, "logs", "launcher.log")
	logf, _ := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if logf != nil {
		defer logf.Close()
		fmt.Fprintf(logf, "\n==== launcher %s start %s install=%s ====\n", version, time.Now().Format(time.RFC3339), install)
	}
	log := func(format string, args ...any) {
		if logf != nil {
			fmt.Fprintf(logf, format+"\n", args...)
			_ = logf.Sync()
		}
	}

	choice := showSplash(install, logf, log)
	if !choice.resultOK {
		log("cancelled")
		return
	}
	log("mode=%s", choice.resultMode)
	if err := startCore(install, choice.resultMode, log); err != nil {
		log("error: %v", err)
		msgBox(fmt.Sprintf("OMNI-CODE failed to start:\n\n%v\n\nLog:\n%s", err, logPath))
	}
}

func showSplash(install string, logf *os.File, log func(string, ...any)) *splashState {
	st := &splashState{install: install, logf: logf}

	bmpPath := ensureLogoFile(install)
	if bmpPath != "" {
		h, err := win.HINSTANCE(0).LoadImage(
			win.ResIdStr(bmpPath),
			co.IMAGE_BITMAP,
			0, 0,
			co.LR_LOADFROMFILE|co.LR_CREATEDIBSECTION,
		)
		if err == nil {
			st.bgBmp = win.HBITMAP(h)
			if bm, e := st.bgBmp.GetObject(); e == nil {
				st.bgW, st.bgH = int(bm.Width), int(bm.Height)
			}
		} else {
			log("LoadImage logo: %v", err)
		}
	}

	var lf win.LOGFONT
	lf.Height = -20
	lf.Weight = co.FW_SEMIBOLD
	lf.CharSet = co.CHARSET_DEFAULT
	lf.SetFaceName("Segoe UI")
	if f, err := win.CreateFontIndirect(&lf); err == nil {
		st.fontTitle = f
	}
	lf.Height = -15
	lf.Weight = co.FW_NORMAL
	if f, err := win.CreateFontIndirect(&lf); err == nil {
		st.fontBody = f
	}

	brush, _ := win.CreateBrushIndirect(&win.LOGBRUSH{Style: co.BRS_SOLID, Color: colorNavy})
	opts := ui.OptsMain().
		Title("OMNI-CODE Launcher " + version).
		Size(ui.Dpi(560, 560)).
		Center(true)
	if brush != 0 {
		opts = opts.ClassBrush(brush)
	}
	st.wnd = ui.NewMain(opts)

	st.wnd.On().WmEraseBkgnd(func(_ ui.WmEraseBkgnd) int { return 1 })
	st.wnd.On().WmPaint(func() { st.paintSplash() })
	st.wnd.On().WmMouseMove(func(p ui.WmMouse) {
		pt := p.Pos()
		h := st.hitTest(int(pt.X), int(pt.Y))
		if h != st.hover {
			st.hover = h
			_ = st.wnd.Hwnd().InvalidateRect(nil, false)
		}
	})
	st.wnd.On().WmLButtonUp(func(p ui.WmMouse) {
		pt := p.Pos()
		switch st.hitTest(int(pt.X), int(pt.Y)) {
		case 1:
			st.modeUltra = false
			_ = st.wnd.Hwnd().InvalidateRect(nil, false)
		case 2:
			st.modeUltra = true
			_ = st.wnd.Hwnd().InvalidateRect(nil, false)
		case 3:
			st.resultOK = true
			if st.modeUltra {
				st.resultMode = "ultra"
			} else {
				st.resultMode = "plain"
			}
			_ = st.wnd.Hwnd().DestroyWindow()
		case 4:
			st.resultOK = false
			_ = st.wnd.Hwnd().DestroyWindow()
		}
	})

	st.wnd.RunAsMain()
	if st.bgBmp != 0 {
		_ = st.bgBmp.DeleteObject()
	}
	if st.fontTitle != 0 {
		_ = st.fontTitle.DeleteObject()
	}
	if st.fontBody != 0 {
		_ = st.fontBody.DeleteObject()
	}
	return st
}

func ensureLogoFile(install string) string {
	dest := filepath.Join(install, "assets", "omni-logo.bmp")
	b, err := logoFS.ReadFile("embed/omni-logo.bmp")
	if err == nil {
		_ = os.MkdirAll(filepath.Dir(dest), 0o755)
		// Refresh asset when embed is newer/larger (quality upgrade)
		if st, e := os.Stat(dest); e != nil || st.Size() != int64(len(b)) {
			_ = os.WriteFile(dest, b, 0o644)
		}
		return dest
	}
	cand := filepath.Join(besideLauncher(), "..", "assets", "omni-logo.bmp")
	if _, e := os.Stat(cand); e == nil {
		return cand
	}
	return ""
}

// layoutRegions returns non-overlapping bands.
// logoDest = aspect-fit rect for the full emblem in the upper area.
func (st *splashState) layoutRegions(cx, cy int) (logoDest, title, plain, ultra, launch, cancel, footer win.RECT) {
	pad := 28
	gap := 14

	// Reserve bottom controls: title(~28) + radios(40) + gap + buttons(48) + gap + footer(24) + pads
	controlsH := 28 + gap + 40 + gap + 48 + gap + 22 + pad
	logoAreaH := cy - controlsH - pad
	if logoAreaH < 180 {
		logoAreaH = 180
	}

	// Aspect-fit (contain) the full logo into [pad, pad, cx-pad, pad+logoAreaH]
	areaW := cx - 2*pad
	areaH := logoAreaH
	dstW, dstH := areaW, areaH
	if st.bgW > 0 && st.bgH > 0 {
		srcAspect := float64(st.bgW) / float64(st.bgH)
		areaAspect := float64(areaW) / float64(areaH)
		if srcAspect > areaAspect {
			dstW = areaW
			dstH = int(float64(areaW) / srcAspect)
		} else {
			dstH = areaH
			dstW = int(float64(areaH) * srcAspect)
		}
	}
	logoLeft := (cx - dstW) / 2
	logoTop := pad + (areaH-dstH)/2
	logoDest = win.RECT{
		Left: int32(logoLeft), Top: int32(logoTop),
		Right: int32(logoLeft + dstW), Bottom: int32(logoTop + dstH),
	}

	y := pad + logoAreaH + 4
	title = win.RECT{Left: int32(pad), Top: int32(y), Right: int32(cx - pad), Bottom: int32(y + 28)}
	y += 28 + gap

	mid := cx / 2
	plain = win.RECT{Left: int32(pad), Top: int32(y), Right: int32(mid - 8), Bottom: int32(y + 40)}
	ultra = win.RECT{Left: int32(mid + 8), Top: int32(y), Right: int32(cx - pad), Bottom: int32(y + 40)}
	y += 40 + gap

	launch = win.RECT{Left: int32(pad), Top: int32(y), Right: int32(mid - 8), Bottom: int32(y + 48)}
	cancel = win.RECT{Left: int32(mid + 8), Top: int32(y), Right: int32(cx - pad), Bottom: int32(y + 48)}
	y += 48 + gap

	footer = win.RECT{Left: int32(pad), Top: int32(y), Right: int32(cx - pad), Bottom: int32(cy - 8)}
	return
}

func (st *splashState) hitTest(x, y int) int {
	rc, _ := st.wnd.Hwnd().GetClientRect()
	_, _, plain, ultra, launch, cancel, _ := st.layoutRegions(int(rc.Right), int(rc.Bottom))
	pt := win.POINT{X: int32(x), Y: int32(y)}
	if ptIn(pt, plain) {
		return 1
	}
	if ptIn(pt, ultra) {
		return 2
	}
	if ptIn(pt, launch) {
		return 3
	}
	if ptIn(pt, cancel) {
		return 4
	}
	return 0
}

func ptIn(p win.POINT, r win.RECT) bool {
	return p.X >= r.Left && p.X < r.Right && p.Y >= r.Top && p.Y < r.Bottom
}

func (st *splashState) paintSplash() {
	hwnd := st.wnd.Hwnd()
	var ps win.PAINTSTRUCT
	hdc, err := hwnd.BeginPaint(&ps)
	if err != nil {
		return
	}
	defer hwnd.EndPaint(&ps)

	rc, _ := hwnd.GetClientRect()
	cx, cy := int(rc.Right), int(rc.Bottom)

	// Solid navy plate (no banding from stretched empty margins)
	navy, _ := win.CreateBrushIndirect(&win.LOGBRUSH{Style: co.BRS_SOLID, Color: colorNavy})
	if navy != 0 {
		_ = hdc.FillRect(&rc, navy)
		_ = navy.DeleteObject()
	}

	logoDest, title, plain, ultra, launch, cancel, footer := st.layoutRegions(cx, cy)

	// Logo — full emblem, aspect-fit, high-quality stretch into upper band only
	if st.bgBmp != 0 && st.bgW > 0 && st.bgH > 0 {
		mem, err := hdc.CreateCompatibleDC()
		if err == nil && mem != 0 {
			old, _ := mem.SelectObjectBmp(st.bgBmp)
			_, _ = hdc.SetStretchBltMode(co.STRETCH_HALFTONE)
			_, _ = hdc.SetBrushOrgEx(win.POINT{X: 0, Y: 0})
			_ = hdc.StretchBlt(
				win.POINT{X: logoDest.Left, Y: logoDest.Top},
				win.SIZE{Cx: logoDest.Right - logoDest.Left, Cy: logoDest.Bottom - logoDest.Top},
				mem,
				win.POINT{X: 0, Y: 0},
				win.SIZE{Cx: int32(st.bgW), Cy: int32(st.bgH)},
				co.ROP_SRCCOPY,
			)
			_, _ = mem.SelectObjectBmp(old)
			_ = mem.DeleteDC()
		}
	}

	// Future: paintFaceOverlay(hdc, cx, cy) between logo and controls

	_, _ = hdc.SetBkMode(co.BKMODE_TRANSPARENT)
	_, _ = hdc.SetTextColor(colorGreen)
	if st.fontTitle != 0 {
		_, _ = hdc.SelectObjectFont(st.fontTitle)
	}
	_ = hdc.TextOut(int(title.Left), int(title.Top)+4, "OMNI-CODE  ·  choose layout")

	if st.fontBody != 0 {
		_, _ = hdc.SelectObjectFont(st.fontBody)
	}
	st.paintChoice(hdc, plain, "OMNI-CODE (Plain)", !st.modeUltra, st.hover == 1)
	st.paintChoice(hdc, ultra, "OMNI-CODE Ultra", st.modeUltra, st.hover == 2)
	st.paintButton(hdc, launch, "Launch", st.hover == 3)
	st.paintButton(hdc, cancel, "Exit", st.hover == 4)

	_, _ = hdc.SetTextColor(colorGreenDim)
	_ = hdc.TextOut(int(footer.Left), int(footer.Top), "v"+version+"  ·  "+st.install)
}

func (st *splashState) paintChoice(hdc win.HDC, r win.RECT, label string, selected, hover bool) {
	bg := colorPanel
	if hover || selected {
		bg = win.RGB(0x0a, 0x22, 0x18)
	}
	brush, _ := win.CreateBrushIndirect(&win.LOGBRUSH{Style: co.BRS_SOLID, Color: bg})
	penColor := colorGreenDim
	if selected {
		penColor = colorGreen
	}
	pen, _ := win.CreatePen(co.PS_SOLID, 2, penColor)
	oldBrush, _ := hdc.SelectObjectBrush(brush)
	oldPen, _ := hdc.SelectObjectPen(pen)
	_ = hdc.Rectangle(r)
	_, _ = hdc.SelectObjectBrush(oldBrush)
	_, _ = hdc.SelectObjectPen(oldPen)
	if brush != 0 {
		_ = brush.DeleteObject()
	}
	if pen != 0 {
		_ = pen.DeleteObject()
	}

	cx := int(r.Left) + 18
	cy := int(r.Top+r.Bottom) / 2
	darkDot, _ := win.CreateBrushIndirect(&win.LOGBRUSH{Style: co.BRS_SOLID, Color: colorPanel})
	ringPen, _ := win.CreatePen(co.PS_SOLID, 2, colorGreen)
	oldB, _ := hdc.SelectObjectBrush(darkDot)
	oldP, _ := hdc.SelectObjectPen(ringPen)
	outer := win.RECT{Left: int32(cx - 8), Top: int32(cy - 8), Right: int32(cx + 8), Bottom: int32(cy + 8)}
	_ = hdc.Ellipse(outer)
	if selected {
		greenDot, _ := win.CreateBrushIndirect(&win.LOGBRUSH{Style: co.BRS_SOLID, Color: colorGreen})
		_, _ = hdc.SelectObjectBrush(greenDot)
		inner := win.RECT{Left: int32(cx - 4), Top: int32(cy - 4), Right: int32(cx + 4), Bottom: int32(cy + 4)}
		_ = hdc.Ellipse(inner)
		if greenDot != 0 {
			_ = greenDot.DeleteObject()
		}
	}
	_, _ = hdc.SelectObjectBrush(oldB)
	_, _ = hdc.SelectObjectPen(oldP)
	if darkDot != 0 {
		_ = darkDot.DeleteObject()
	}
	if ringPen != 0 {
		_ = ringPen.DeleteObject()
	}

	_, _ = hdc.SetTextColor(colorGreen)
	_, _ = hdc.SetBkMode(co.BKMODE_TRANSPARENT)
	_ = hdc.TextOut(int(r.Left)+36, int(r.Top)+11, label)
}

func (st *splashState) paintButton(hdc win.HDC, r win.RECT, label string, hover bool) {
	bg := colorBtnFill
	if hover {
		bg = colorBtnHover
	}
	brush, _ := win.CreateBrushIndirect(&win.LOGBRUSH{Style: co.BRS_SOLID, Color: bg})
	pen, _ := win.CreatePen(co.PS_SOLID, 2, colorGreen)
	oldB, _ := hdc.SelectObjectBrush(brush)
	oldP, _ := hdc.SelectObjectPen(pen)
	_ = hdc.RoundRect(r, win.SIZE{Cx: 10, Cy: 10})
	_, _ = hdc.SelectObjectBrush(oldB)
	_, _ = hdc.SelectObjectPen(oldP)
	if brush != 0 {
		_ = brush.DeleteObject()
	}
	if pen != 0 {
		_ = pen.DeleteObject()
	}
	_, _ = hdc.SetTextColor(colorGreen)
	_, _ = hdc.SetBkMode(co.BKMODE_TRANSPARENT)
	tx := int(r.Left) + int(r.Right-r.Left)/2 - len(label)*4
	ty := int(r.Top) + 15
	_ = hdc.TextOut(tx, ty, label)
}

func startCore(install, mode string, log func(string, ...any)) error {
	core := findCore(install)
	if core == "" {
		return fmt.Errorf("omni-core.exe not found under %s\\bin", install)
	}
	uiDir := resolveUIDir(install, core)
	if _, err := os.Stat(filepath.Join(uiDir, "index.html")); err != nil {
		return fmt.Errorf("UI missing at %s", uiDir)
	}
	uiDir, _ = filepath.Abs(uiDir)
	core, _ = filepath.Abs(core)
	args := []string{"--mode", mode, "--data-dir", install, "--ui-dir", uiDir, "--port", "8741"}
	log("spawn %s %v", core, args)
	cmd := exec.Command(core, args...)
	cmd.Dir = filepath.Dir(core)
	if err := cmd.Start(); err != nil {
		return err
	}
	log("pid=%d", cmd.Process.Pid)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("omni-core exited: %w (see logs\\omni-core.log)", err)
		}
		return nil
	case <-time.After(3 * time.Second):
		return nil
	}
}

func resolveUIDir(install, core string) string {
	for _, c := range []string{
		filepath.Join(filepath.Dir(core), "..", "ui", "dist"),
		filepath.Join(install, "ui", "dist"),
	} {
		if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
			return c
		}
	}
	return filepath.Join(install, "ui", "dist")
}

func installRoot() string {
	if v := os.Getenv("OMNI_HOME"); v != "" {
		return v
	}
	beside := besideLauncher()
	if filepath.Base(beside) == "bin" {
		parent := filepath.Dir(beside)
		if _, err := os.Stat(filepath.Join(beside, "omni-core.exe")); err == nil {
			return parent
		}
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, ".omni-neural-ide")
}

func besideLauncher() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	if r, e := filepath.EvalSymlinks(exe); e == nil {
		exe = r
	}
	return filepath.Dir(exe)
}

func findCore(install string) string {
	name := "omni-core.exe"
	if runtime.GOOS != "windows" {
		name = "omni-core"
	}
	var best string
	var bestMod time.Time
	for _, c := range []string{
		filepath.Join(besideLauncher(), name),
		filepath.Join(install, "bin", name),
	} {
		st, err := os.Stat(c)
		if err != nil || st.IsDir() {
			continue
		}
		if best == "" || st.ModTime().After(bestMod) {
			best, bestMod = c, st.ModTime()
		}
	}
	return best
}

func msgBox(text string) {
	_, _ = win.HWND(0).MessageBox(text, "OMNI-CODE Launcher", co.MB_ICONERROR)
}
