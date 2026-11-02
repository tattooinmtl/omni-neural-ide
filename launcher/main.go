package main

import (
	"fmt"
	"os"
	"os/exec"
	"time"
)

func main() {
	fmt.Println("OMNI-CODE launcher")
	fmt.Println("Checking for updates...")
	time.Sleep(800 * time.Millisecond)

	core := "../core/target/release/omni-core"
	if _, err := os.Stat(core); err != nil {
		core = "../core/target/debug/omni-core"
	}

	cmd := exec.Command(core)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		fmt.Println("Failed to start core:", err)
		os.Exit(1)
	}
}
