# Running synthnet on a phone

Four ways, from least to most effort. All of them work with the network
completely off; that is the whole point of the project. None of them need an
account, a store listing, or a server you do not own.

Nothing here is fast because it is clever — it is fast because there is almost
nothing to load.

---

## 0. The app

`synthnet.apk` — install it, tap the icon, it opens. No browser, no server, no
Termux, no file manager. This is the one you want.

Get it from the **synthnet-android-apk** artifact on any green CI run, or build
it yourself:

```
python3 synthnet/tools/build.py      # generate the site
bash synthnet/android/build.sh       # package it
```

Copy `synthnet/android/synthnet.apk` to the phone and open it. Android will ask
you to allow installing from that app the first time — that is the normal
sideload prompt, not a warning that something is wrong. Needs Android 8.0 or
newer.

**The app declares no permissions at all.** Not internet, not storage, not
anything. That is deliberate and it is checked in CI: without the INTERNET
permission Android refuses every socket the process opens, so "works offline"
stops being a claim in a README and becomes something the operating system
enforces. The app cannot phone home, cannot be told to, and has nothing to
leak. The entire synthetic internet is inside the APK.

Two honest notes. The APK is signed with a generated debug key, which is fine
for sideloading and not fine for a store listing — a real release needs a key
you control. And the app has been built and verified but never run on a
physical device, because the machine that built it has no Android hardware and
no emulator; what *is* verified is that it is correctly signed, declares no
permissions, and contains every single file the page asks for.

---

## 1. Zero install: one file, open it from the file manager

Copy **`dist/synthnet.html`** to the phone (USB cable, SD card, Bluetooth,
a file transfer app, whatever you already use) and tap it. Android's file
manager will open it in Chrome and it runs.

That one file contains everything: the chrome, every skin, every script, and
every site's content inlined as JSON. No fetches happen at all, so `file://`
restrictions never come up.

**Trade-offs, plainly:**

- It is one big file. It gets bigger with every site you add. Re-copy it every
  time you rebuild; there is no update mechanism.
- No service worker and no PWA install, because `file://` pages cannot register
  one. No icon on the home screen, no standalone window — it is a browser tab.
- Some file managers hand `.html` to a text viewer instead of a browser. Use
  "Open with" and pick Chrome.
- Very large bundles (tens of MB) are slow to open on old phones, because
  Chrome parses the whole JSON blob at startup. If that bites, use option 2.

Rebuild the bundle before copying:

```
python3 tools/build.py
```

The build prints the final byte size. Watch that number.

---

## 2. Termux: the real version

This is the mode with a service worker, a home-screen icon, and lazy loading
(only the site you are looking at is fetched). It is still entirely local —
the "server" is your own phone talking to itself on the loopback interface.

### Getting Termux

Install Termux from **F-Droid** or from the **Termux GitHub releases**. Search
for either in the app you already use to install F-Droid packages; the release
APKs are also linked from the project's own README.

The **Play Store** build exists but has historically lagged well behind, and
packages installed under it have broken in ways the F-Droid build does not.
If you have the Play Store one and `pkg install` misbehaves, that is why —
uninstall it and use the F-Droid build.

### Setup, once

```
pkg update
pkg upgrade
pkg install python git
```

Then get the project onto the phone. Either clone it:

```
git clone <your-remote> synthnet-repo
cd synthnet-repo/synthnet
```

or, if you copied the folder over by hand, give Termux access to shared
storage first and copy it into the Termux home directory (working from
`/sdcard` directly is slower and sometimes read-only):

```
termux-setup-storage          # tap Allow
cp -r ~/storage/shared/Download/synthnet ~/synthnet
cd ~/synthnet
```

### Every time

```
python3 tools/build.py        # only needed after you change content
python3 tools/serve.py
```

It prints something like:

```
synthnet is serving /data/data/com.termux/files/home/synthnet
  local   (scheme)localhost:8080/
  lan     (scheme)192.168.1.37:8080/
  bundle  (scheme)localhost:8080/dist/synthnet.html
stop with Ctrl-C
```

Open the **local** URL in Chrome — typing `localhost:8080` into the address
bar is enough, the browser fills in the scheme.

### Make it a home-screen app

With the page open in Chrome: menu → **Add to Home Screen** (it may say
*Install app*). Accept.

Once installed, the service worker has cached the shell and everything it
needs. From then on you can put the phone in **aeroplane mode**, tap the icon,
and it loads — the service worker answers the requests, not the network, and
not even Termux. You only need `serve.py` running again when you want to pick
up newly built content, or when the browser evicts the cache.

Two caveats worth knowing:

- Android will eventually kill Termux in the background. That does not break
  the installed app (the service worker is independent), but it does mean the
  server is gone next time you want to refresh content. Disable battery
  optimisation for Termux, or just start it again.
- Chrome may evict a site's storage under heavy pressure. If the icon opens to
  an error, start `serve.py` and load it once more.

---

## 3. Anything else that serves a folder

The project has no build requirement for the served mode — it is plain files —
so any static server works:

- **A static-server app** from the store ("Simple HTTP Server", "Web Server for
  Chrome"-alikes, KSWEB, and so on). Point it at the `synthnet` folder, set the
  port, open the URL it gives you. You lose nothing; you just are not using
  Termux. Note that some of these serve `.json` with the wrong MIME type, which
  the engine tolerates but is worth checking if something will not load.
- **A desktop on the same wifi.** Run `python3 tools/serve.py` on the laptop
  and open the printed `lan` URL on the phone. Handy for authoring: edit on the
  laptop, rebuild, pull to refresh on the phone.
- **A USB cable and `adb reverse tcp:8080 tcp:8080`**, if you already live in
  that world. Then `localhost:8080` on the phone reaches the desktop.

---

## Troubleshooting

**Blank page when I open `index.html` from the file manager.**
Expected. `index.html` fetches `net/registry.json`, and `file://` blocks that.
Open `dist/synthnet.html` instead, or serve the folder.

**Search finds nothing / a site 404s that should exist.**
`net/search.json` and `net/registry.json` are generated. Run
`python3 tools/build.py`. If you are on the bundle, rebuild and re-copy it.

**"Address already in use".**
Something else has the port. `python3 tools/serve.py --port 8181`.

**The phone cannot reach the desktop's LAN URL.**
Same wifi network? Many guest and public networks have client isolation turned
on, which blocks device-to-device traffic entirely — no fix from this side.
Also check the desktop firewall, and that the server is bound to `0.0.0.0`
(the default) rather than `127.0.0.1`.

**Chrome will not offer "Add to Home Screen".**
It needs a served page (not `file://`), a reachable web manifest, and a
registered service worker. Confirm you opened the `localhost` URL, not the
bundle.

**I rebuilt but the phone still shows the old content.**
`serve.py` sends `Cache-Control: no-cache`, so a plain reload is normally
enough. If the installed PWA is stubborn, Chrome → site settings → clear
storage for it, or uninstall the home-screen icon and add it again.

**`pkg install python` fails in Termux.**
Almost always the Play Store build, or a mirror problem. Try
`termux-change-repo`, then `pkg update` again. Otherwise switch to the F-Droid
build.

**Everything is slow on an old phone.**
Lower the bundle size (fewer sites, or use the served mode so sites load
lazily). The single-file bundle is the expensive one.

---

## What this is not

It is not a network, not a peer-to-peer thing, not multi-user, and nothing you
type into it persists anywhere. Guestbooks and reply boxes are period set
dressing. It is a large, self-consistent, entirely offline archive that behaves
like a browser — and it will keep working in ten years on any device that can
still open an HTML file.
