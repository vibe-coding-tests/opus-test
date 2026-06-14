# Running DuelStrike on Windows

The game runs entirely in your browser, so the only thing Windows needs is Node.js. Install it, start the local server, and play.

## 1. Install Node.js

Download the LTS Windows installer from [nodejs.org](https://nodejs.org) and run it with the default options. The game needs Node 20.19 or newer; any current LTS works.

Check it took by opening PowerShell and running:

```powershell
node --version
```

## 2. Get the game files

**No Git? Just download the ZIP.** On the [GitHub page](https://github.com/char-boomer-remakes/wizard-duel), click the green **Code** button, choose **Download ZIP**, then right-click the file and **Extract All**. That gives you a `wizard-duel` folder — no extra tools needed.

**If you have Git**, clone the repo instead:

```powershell
git clone https://github.com/char-boomer-remakes/wizard-duel.git
cd wizard-duel
```

(Don't have Git but want it? Grab it from [git-scm.com](https://git-scm.com/download/win) and run the installer with the defaults.)

Either way, you can also copy the project folder over by USB or zip. Leave out `node_modules` when copying from a Mac; the next step rebuilds it for Windows.

## 3. Install and play

From the project folder in PowerShell:

```powershell
npm install
npm start
```

Your default browser opens `http://localhost:5173` and the game loads. Edge, Chrome, and Firefox all work. Once `npm install` finishes, everything runs locally with no internet needed.

Start the game with `npm start` each time. The page needs Vite's local server to load its modules, so opening `index.html` straight from the folder shows a blank page.

## Troubleshooting

- **"running scripts is disabled on this system"** — PowerShell is blocking npm's script wrapper. Use Command Prompt instead, or run this once in PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- **The browser doesn't open by itself** — go to `http://localhost:5173` manually.
- **Port 5173 is already in use** — run `npx vite --port 5174 --open` to pick another port.
