'use strict';

/**
 * `bin\cleandrive.cmd`, the way into the command line from a terminal.
 *
 * CleanDrive.exe is a Windows (GUI-subsystem) program. Measured on 2026-10-01:
 * PowerShell typed bare and an interactive cmd both return before such a
 * program has finished, so its output lands after the next prompt and its
 * exit code is lost; `$x = & CleanDrive.exe ...` captures nothing at all. cmd
 * running a batch file does wait, and passes the code on with `exit /b` --
 * so this two-line file is what makes `cleandrive scan C:\` behave like a
 * command. It holds no logic: everything it starts is the signed executable.
 *
 * It lives in `bin\`, not beside the executable, because Windows tries `.EXE`
 * before `.CMD` (PATHEXT): with both in one folder, `cleandrive` would open the
 * window. And it clears ELECTRON_RUN_AS_NODE for itself, because with that set
 * -- the shell this project is developed in sets it -- the executable runs as
 * a bare Node and takes `--cli` for the name of a script.
 *
 * The cost, also measured: Ctrl+C ends the program at once, and cmd then asks
 * "Terminate batch job (Y/N)?". Either answer leaves nothing behind.
 */

const PRODUCT_EXE = 'CleanDrive.exe';

/** The file's text, CRLF, ASCII only (cmd reads a batch file in the OEM code page). */
function shimText() {
  const lines = [
    '@echo off',
    'rem CleanDrive command line. See "cleandrive help".',
    'rem CleanDrive.exe is a Windows program, and only a batch file makes cmd and',
    'rem PowerShell wait for one and keep its exit code. This file holds no logic.',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=',
    `"%~dp0..\\${PRODUCT_EXE}" --cli %*`,
    'exit /b %errorlevel%',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { shimText, PRODUCT_EXE };
