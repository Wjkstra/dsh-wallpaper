# Furina desktop decoration for DSH

A DSH profile bundle that adds three things to the Desktop Web UI:

- **Curtain-rise startup movie** — plays on page load, with a progress line,
  original-sound toggle, and `Esc`/skip button.
- **Water-opera wallpaper** — the user-provided
  “水光歌剧院中的优雅舞者” image, layered under a dark wash so the chat,
  sidebar, menus, and settings stay readable.
- **Live balance card** — sits in the sidebar footer above Settings, so it
  never covers page controls; shows recharge balance, spent, granted bonus, and
  the last-read time, polled every five minutes through the signed-in DeepSeek
  account.

## Custom media

Open **Settings → Desktop decoration** (设置 → 桌面装饰) and use:

- **Choose video** — MP4 or WebM, up to 300 MB.
- **Choose background** — JPG, PNG, WebP, GIF, or BMP, up to 50 MB.
- **Restore default** — returns either kind to the packaged media.
- **Preview** — replays the current startup movie immediately.

Uploads are stored under `$DSH_HOME/furina-media` (normally
`C:\Users\<you>\.dsh\furina-media`) and survive restarts. The same panel reports
whether the active source is the packaged default or your custom file.

## Install from the plugin index

Add this index URL in **Plugins → Discover → Add index source**:

```text
https://raw.githubusercontent.com/Wjkstra/dsh-wallpaper/main/v2/index.json
```

Then install **Furina desktop decoration** (`dsh-furina-decoration`). The bundle
is also installable directly from the `plugin/` directory with the DSH plugin
manager.

## Rights

The source code is MIT-licensed. The wallpaper is supplied by the repository
owner; the bundled `assets/boot.mp4` comes from the user's local `dsh-desktop`
installation. See `THIRD_PARTY_NOTICES.md`.
