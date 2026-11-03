use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" {
        return;
    }
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let ico = manifest.join("../assets/omni.ico");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let rc = out.join("omni.rc");
    let obj = out.join("omni_icon.o");
    let ico_abs = ico.canonicalize().unwrap_or(ico.clone());
    std::fs::write(
        &rc,
        format!("IDI_ICON1 ICON \"{}\"\n", ico_abs.display().to_string().replace('\\', "/")),
    )
    .expect("write rc");

    let mingw = "/tmp/llvm-mingw-20241030-ucrt-ubuntu-20.04-x86_64/bin";
    let windres = format!("{mingw}/x86_64-w64-mingw32-windres");
    let status = Command::new(&windres)
        .args([
            rc.to_str().unwrap(),
            "-O",
            "coff",
            "-o",
            obj.to_str().unwrap(),
        ])
        .status();
    match status {
        Ok(s) if s.success() => {
            println!("cargo:rustc-link-arg={}", obj.display());
            println!("cargo:rerun-if-changed={}", ico_abs.display());
        }
        Ok(s) => println!("cargo:warning=windres exited {s}"),
        Err(e) => println!("cargo:warning=windres failed: {e}"),
    }
}
