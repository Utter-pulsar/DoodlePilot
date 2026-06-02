<div align="center">
  <img src="./img/title.svg" alt="DoodlePilot" width="520" />

  <h3>Your hand-drawn desktop work buddy.</h3>
  <p>A cozy, doodle-style project board — plus little paper-plane alarms that fly your reminders across the screen.</p>

  <p>
    <a href="./LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-5B8DEF.svg" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-win%20%7C%20mac%20%7C%20linux-2B2B2B.svg" />
    <img alt="Electron 34" src="https://img.shields.io/badge/Electron-34-47848F.svg?logo=electron&logoColor=white" />
    <img alt="Status: actively tinkered on" src="https://img.shields.io/badge/status-actively%20tinkered%20on-FFD23F.svg" />
  </p>

  <h4>
    English &nbsp;|&nbsp; <a href="./README.zh-CN.md">简体中文</a>
  </h4>
</div>

<br />

<div align="center">
  <img src="./img/img.png" alt="DoodlePilot screenshot" width="820" />
</div>

<br />

DoodlePilot is a tiny desktop app that makes planning your day feel less like _work software_ and more like scribbling in the corner of a notebook. Everything is hand-drawn — wobbly Rough.js borders, the Excalifont typeface, a warm paper grid — and everything is springy and Q-bouncy to the touch.

## Features

- 🎨&nbsp;&nbsp;**Hand-drawn, everywhere** — sketchy Rough.js borders, Excalifont, a warm paper-grid canvas.
- 🗂️&nbsp;&nbsp;**Lark/Feishu-style board** — vertical lanes and cards you fully customize, resize, and reorder.
- 🧩&nbsp;&nbsp;**Rich field types** — text, number (drag up/down to scrub!), status, checklist, single/multi tags, date (a hand-drawn calendar), date range, checkbox, link, relation & person.
- ✅&nbsp;&nbsp;**Daily tasks** — one card per day; mark each task to-do / doing / done; press **open tomorrow** and unfinished tasks carry over while the whole day is archived.
- ⏰&nbsp;&nbsp;**Paper-plane alarms** — when it's time, a little plane tows your reminder banner across the desktop.
- ⏳&nbsp;&nbsp;**Lead time & repeats** — remind me _X minutes before_, and _every X minutes_.
- 🧈&nbsp;&nbsp;**Q-bouncy motion** — springy drag-to-reorder, and grab-empty-space kinetic scrolling with an elastic rubber-band at the edges.
- 🗃️&nbsp;&nbsp;**Archive & restore** — every lane gets its own “-history” lane; one click puts a card back.
- 🌓&nbsp;&nbsp;**Light / dark paper** themes.
- 🔒&nbsp;&nbsp;**Local-first** — your data lives in a single local SQLite file. Nothing leaves your machine.
- 🖥️&nbsp;&nbsp;**Cross-platform** — Windows, macOS and Linux (Electron).
- ⚒️&nbsp;&nbsp;**Hackable core** — a typed query / command / event / hook contract, so an assistant or script can drive the board.

## Why DoodlePilot?

I wanted a **work buddy** — 我心目中的「办公搭子」 — that lives on my desktop and makes getting organized feel warm and playful instead of corporate. Most task tools are grey grids and rigid forms; I wanted something that feels like a doodle in the margin of a notebook, that bounces when you poke it, and that nudges me with a little plane instead of a cold notification.

So I started building it for myself. **This is a personal project**, and now that this version feels good, I'll keep polishing it in my spare time — adding the pieces I wish my "office companion" had.

If you have an idea, a wish, or you hit a bug, **please open an [issue](../../issues)!** I'd genuinely love to hear how _you'd_ want your own desktop buddy to work. 💛

## Getting started

DoodlePilot is built with Electron + Vite + React.

```bash
# install dependencies
npm install

# run in dev mode (hot reload)
npm run dev

# type-check + production build
npm run build

# package an installer for your OS
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

Your data is stored locally in your OS app-data folder:

- **Windows** — `%APPDATA%\DoodlePilot\doodlepilot.sqlite`
- **macOS** — `~/Library/Application Support/DoodlePilot/`
- **Linux** — `~/.config/DoodlePilot/`

If you want to download mac version, please type the following command after dragging ```DoodlePilot.app``` into the application because of the signature.

```bash
sudo xattr -cr /Applications/DoodlePilot.app
# if the file still broken then:
sudo codesign --force --deep --sign - /Applications/DoodlePilot.ap
```

If you want to download deb version, please follow the following instruction to set the sandbox setuid and the icon.

```bash
DEB=./doodlepilot_x.x.x_amd64.deb

sudo apt install -y "$DEB"                                    # 装（自动拉依赖；deb前必须带 ./）
sudo chmod 4755 /opt/DoodlePilot/chrome-sandbox              # 坑①：沙箱补 setuid，否则打不开
for s in 128 256 512; do                                     # 坑②：图标补到标准尺寸目录
  sudo install -Dm644 /usr/share/icons/hicolor/1254x1254/apps/doodlepilot.png \
    /usr/share/icons/hicolor/${s}x${s}/apps/doodlepilot.png
done
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor       # 刷新图标缓存
```

## Tech stack

Electron · electron-vite · React 19 · Zustand · Tailwind CSS · framer-motion · PixiJS · Rough.js · sql.js · TypeScript.

## Status & roadmap

This version is **frozen and happy** 🎉 — and it's a beginning, not an end. I'll keep adding features as a hobby, whenever there's a spare evening: more field types, smarter daily/weekly flows, and more delightful little animations over time.

## Contributing

This is a one-person hobby project, but ideas are very welcome — open an [issue](../../issues) to suggest a feature, share a mockup, or report something that feels off. ✏️

## License

DoodlePilot is released under the [GNU GPLv3](./LICENSE).

Any modified or derivative version — whether **distributed** or **offered as a network service** — must:

- stay licensed under **GPLv3 / AGPLv3**,
- **keep the original copyright notice**,
- **clearly state what was changed**.
