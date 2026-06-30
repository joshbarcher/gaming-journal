import { execSync, spawn } from 'child_process'

const PORT = process.env.PORT || '5173'

// Kill whatever is holding the port, if anything
try {
    const result = execSync(
        `netstat -ano | findstr ":${PORT} " | findstr "LISTENING"`,
        { encoding: 'utf8', shell: 'cmd.exe' }
    ).trim()

    const pid = result.trim().split(/\s+/).at(-1)
    if (pid && /^\d+$/.test(pid)) {
        execSync(`taskkill /PID ${pid} /F`, { shell: 'cmd.exe', stdio: 'ignore' })
        console.log(`Killed process ${pid} on port ${PORT}`)
    }
} catch {
    // Port was free — nothing to do
}

const vite = spawn('npx', ['vite', 'dev'], { stdio: 'inherit', shell: true })
vite.on('exit', code => process.exit(code ?? 0))
