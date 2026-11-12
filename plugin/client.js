/**
 * Browser half of the Furina decoration bundle.
 *
 * Three additions to the shipped shell, all mounted in the `shell.overlay`
 * list so they live beside the app instead of replacing any seat:
 *
 *   dsh-furina-background  paints the Furina hall wallpaper behind the UI
 *   dsh-furina-boot        plays the curtain-rise startup movie once per load
 *   dsh-furina-balance     shows the live DeepSeek account balance (5 min poll)
 */

window.__ModuleLoader__.load({
  id: 'dsh-furina-decoration',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const ASSET_BASE = '/dsh-furina'
    const MEDIA_BASE = `${ASSET_BASE}/media`
    const POLL_MS = 5 * 60 * 1000

    // One page-local revision drives every media URL. Uploading or resetting
    // bumps it so the CSS wallpaper, the tint, the player, and the preview all
    // reload the same new file without a full page refresh.
    let mediaRevision = 0
    const mediaListeners = new Set()
    const replayListeners = new Set()

    function mediaUrl(kind) {
      return `${MEDIA_BASE}/${kind}?v=${mediaRevision}`
    }

    function bumpMediaRevision() {
      mediaRevision += 1
      for (const listener of mediaListeners) listener()
    }

    function replayBoot() {
      for (const listener of replayListeners) listener()
    }

    /** Subscribe one component to the current media revision. */
    function useMediaRevision() {
      const [revision, setRevision] = React.useState(mediaRevision)
      React.useEffect(() => {
        const listener = () => setRevision(mediaRevision)
        mediaListeners.add(listener)
        return () => { mediaListeners.delete(listener) }
      }, [])
      return revision
    }

    /** Wallpaper plus the same dark wash the desktop startup page uses. */
    function Background() {
      const revision = useMediaRevision()
      const wallpaper = `${MEDIA_BASE}/background?v=${revision}`
      return h('style', { 'data-dsh-furina': 'background' }, `
html {
  background-color: #0a101c !important;
  background-image:
    linear-gradient(180deg, rgba(6, 10, 18, 0.28) 0%, rgba(6, 10, 18, 0.52) 55%, rgba(6, 10, 18, 0.80) 100%),
    radial-gradient(90% 70% at 50% 30%, rgba(10, 20, 40, 0.12) 0%, rgba(6, 10, 18, 0.50) 100%),
    url("${wallpaper}");
  background-position: center, center, center;
  background-size: auto, auto, cover;
  background-repeat: no-repeat, no-repeat, no-repeat;
  background-attachment: fixed, fixed, fixed;
}
body, #root, body > div, #root > * {
  background-color: transparent !important;
  background-image: none !important;
}
/* Paint the hall on each shell column as well: those columns own an opaque
   theme fill in the Windows build, so transparency alone never reveals html. */
#root > * > div:not([data-shell-overlay]) {
  background-color: transparent !important;
  background-image:
    linear-gradient(180deg, rgba(6, 10, 18, 0.32) 0%, rgba(6, 10, 18, 0.64) 100%),
    url("${wallpaper}") !important;
  background-position: center, center !important;
  background-size: auto, cover !important;
  background-repeat: no-repeat, no-repeat !important;
  background-attachment: fixed, fixed !important;
}
/* The column's first child paints the panel plate; clear it so the column's
   fixed wallpaper is what shows through instead of an opaque theme fill. */
#root > * > div:not([data-shell-overlay]) > div:first-child {
  background-color: transparent !important;
  background-image: none !important;
}
body::before, body::after {
  background-image: none !important;
}
#dsh-furina-balance, #dsh-furina-balance * { box-sizing: border-box; }
#dsh-furina-balance button { font: inherit; }
#dsh-furina-boot { background-color: #030914 !important; }
#dsh-furina-boot button { font: inherit; }
#dsh-furina-wallpaper { opacity: .22 !important; }
html:not([data-ds-dark-theme]) #dsh-furina-wallpaper {
  opacity: .08 !important;
  mix-blend-mode: multiply !important;
}
#dsh-furina-boot button:hover, #dsh-furina-boot button:focus-visible {
  background: #18344e !important;
  border-color: #93bedc !important;
  outline: none;
}
@media (prefers-reduced-motion: reduce) {
  #dsh-furina-boot { transition: none !important; }
}
      `)
    }

    /** A low-opacity hall layer over the shell plate; the panels stay readable. */
    function WallpaperTint() {
      const revision = useMediaRevision()
      const wallpaper = `${MEDIA_BASE}/background?v=${revision}`
      return h('div', {
        id: 'dsh-furina-wallpaper',
        'aria-hidden': true,
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 4,
          pointerEvents: 'none',
          background: `url("${wallpaper}") center / cover no-repeat fixed`,
          mixBlendMode: 'screen',
          filter: 'saturate(1.05)',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.72) 62%, rgba(0,0,0,0.38) 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.72) 62%, rgba(0,0,0,0.38) 100%)',
        },
      })
    }

    /** Start-up movie with the desktop's footer, sound toggle and Esc skip. */
    function BootOverlay() {
      const videoRef = React.useRef(null)
      const progressRef = React.useRef(null)
      const doneRef = React.useRef(false)
      const revision = useMediaRevision()
      const source = `${MEDIA_BASE}/boot?v=${revision}`
      const [phase, setPhase] = React.useState('playing')
      const [muted, setMuted] = React.useState(true)

      const finish = React.useCallback((immediate) => {
        if (doneRef.current) return
        doneRef.current = true
        const video = videoRef.current
        if (video !== null) {
          video.pause()
          video.removeAttribute('src')
          try { video.load() } catch (_error) { /* the element may already be detached */ }
        }
        setPhase(immediate ? 'done' : 'leaving')
      }, [])

      React.useEffect(() => {
        const onReplay = () => {
          doneRef.current = false
          setMuted(true)
          setPhase('playing')
        }
        replayListeners.add(onReplay)
        return () => { replayListeners.delete(onReplay) }
      }, [])

      React.useEffect(() => {
        if (phase !== 'leaving') return undefined
        const timer = setTimeout(() => setPhase('done'), 380)
        return () => clearTimeout(timer)
      }, [phase])

      React.useEffect(() => {
        if (phase !== 'playing') return undefined
        const video = videoRef.current
        if (video === null) return undefined
        const reduced = typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : undefined
        if (reduced !== undefined && reduced.matches) {
          finish(true)
          return undefined
        }

        const onEnded = () => finish(false)
        const onError = () => finish(true)
        const onTimeUpdate = () => {
          if (progressRef.current === null || !Number.isFinite(video.duration) || video.duration <= 0) return
          const ratio = Math.min(1, Math.max(0, video.currentTime / video.duration))
          progressRef.current.style.transform = `scaleX(${ratio})`
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(true)
          }
        }
        const onPageHide = () => finish(true)

        video.addEventListener('ended', onEnded)
        video.addEventListener('error', onError)
        video.addEventListener('timeupdate', onTimeUpdate)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('pagehide', onPageHide, { once: true })
        const playback = video.play()
        if (playback !== undefined && typeof playback.catch === 'function') {
          playback.catch(() => finish(true))
        }

        return () => {
          video.pause()
          video.removeEventListener('ended', onEnded)
          video.removeEventListener('error', onError)
          video.removeEventListener('timeupdate', onTimeUpdate)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('pagehide', onPageHide)
        }
      }, [finish, phase, revision])

      if (phase === 'done') return null

      const overlay = h('div', {
        id: 'dsh-furina-boot',
        role: 'region',
        'aria-label': 'DSH 水幕启演启动动画',
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 2147483600,
          overflow: 'hidden',
          background: '#030914',
          opacity: phase === 'leaving' ? 0 : 1,
          transition: 'opacity .36s ease',
          pointerEvents: phase === 'leaving' ? 'none' : 'auto',
        },
      },
      h('video', {
        ref: videoRef,
        src: source,
        muted,
        playsInline: true,
        preload: 'auto',
        'aria-label': '原神原剧情：罪人的终幕',
        style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain', background: '#030914' },
      }),
      h('div', {
        className: 'dsh-furina-boot-footer',
        style: {
          position: 'absolute',
          bottom: 25,
          left: '4.2%',
          right: '4.2%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          font: '10px "Segoe UI", "Microsoft YaHei", sans-serif',
          letterSpacing: '.24em',
          color: '#9bb8d0',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
        h('span', null, 'THE CURTAIN RISES'),
        h('span', {
          style: { display: 'block', height: 1, width: 80, background: '#26384d', overflow: 'hidden' },
        }, h('span', {
          ref: progressRef,
          style: {
            display: 'block', height: '100%', width: '100%', background: '#a4dcff',
            transform: 'scaleX(0)', transformOrigin: 'left',
          },
        })),
      ),
      h('div', { style: { display: 'flex', gap: 10 } },
        h('button', {
          type: 'button',
          'aria-pressed': String(!muted),
          onClick: () => {
            const video = videoRef.current
            if (video === null) return
            video.muted = !video.muted
            setMuted(video.muted)
          },
          style: buttonStyle,
        }, muted ? '开启原声' : '关闭原声'),
        h('button', {
          type: 'button',
          onClick: () => finish(true),
          style: buttonStyle,
        }, '跳过动画 · Esc'),
      )))
      return typeof document === 'undefined' ? overlay : ReactDOM.createPortal(overlay, document.body)
    }

    const buttonStyle = {
      padding: '10px 14px',
      border: '1px solid #60789166',
      borderRadius: 4,
      background: '#081526cc',
      color: '#c7dbea',
      fontSize: 12,
      letterSpacing: '.05em',
      cursor: 'pointer',
    }

    /** Two-decimal currency text; keeps sub-cent amounts readable. */
    function formatAmount(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return String(value)
      if (number === 0) return '0.00'
      if (number < 0) return `-${formatAmount(String(-number))}`
      if (number < 0.01) return '<0.01'
      return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    /** Currency symbol used by the Platform wallet display. */
    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    /** Fold wallets into one amount per currency, ignoring malformed rows. */
    function walletMap(wallets) {
      const result = {}
      if (!Array.isArray(wallets)) return result
      for (const wallet of wallets) {
        if (wallet === null || typeof wallet !== 'object') continue
        const currency = wallet.currency === 'USD' ? 'USD' : 'CNY'
        const amount = Number(wallet.balance)
        if (!Number.isFinite(amount)) continue
        result[currency] = (result[currency] ?? 0) + amount
      }
      return result
    }

    /** Stable display order: CNY first, then USD, then anything else. */
    function orderedCurrencies(...maps) {
      const seen = new Set()
      for (const map of maps) for (const key of Object.keys(map)) seen.add(key)
      return [...seen].sort((a, b) => {
        const rank = { CNY: 0, USD: 1 }
        return (rank[a] ?? 2) - (rank[b] ?? 2) || a.localeCompare(b)
      })
    }

    /** Format one account balance response into the desktop chip's sentence. */
    function describeBalance(value, baseline) {
      if (value === null || value === undefined) return { text: '余额：未登录', signedOut: true }
      if (value.status !== 'ready') return { text: '余额：读取失败' }
      const current = walletMap(value.value)
      const bonus = walletMap((value.bonusWallets ?? []).filter(wallet => Number(wallet?.balance) > 0))
      if (Object.keys(baseline).length === 0) {
        for (const [currency, amount] of Object.entries(current)) baseline[currency] = amount
      }
      const spent = {}
      for (const [currency, base] of Object.entries(baseline)) {
        const difference = base - (current[currency] ?? 0)
        if (difference > 0.000001) spent[currency] = difference
      }
      const parts = []
      for (const currency of orderedCurrencies(current)) {
        parts.push(`余额 ${symbolOf(currency)}${formatAmount(current[currency])}`)
      }
      for (const currency of orderedCurrencies(spent)) {
        parts.push(`已用 ${symbolOf(currency)}${formatAmount(spent[currency])}`)
      }
      for (const currency of orderedCurrencies(bonus)) {
        if (bonus[currency] > 0) parts.push(`赠金 ${symbolOf(currency)}${formatAmount(bonus[currency])}`)
      }
      if (parts.length === 0) parts.push('余额 ¥0.00')
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      return { text: `${parts.join(' · ')} · ${time}（每 5 分钟自动刷新）` }
    }

    /** Live balance pill in the frame-wide overlay; polls every five minutes. */
    function BalanceChip({ load }) {
      const [text, setText] = React.useState('余额：读取中…')
      const [busy, setBusy] = React.useState(false)
      const [signedOut, setSignedOut] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const aliveRef = React.useRef(true)
      const busyRef = React.useRef(false)
      const baselineRef = React.useRef({})

      const refresh = React.useCallback(async (manual) => {
        if (busyRef.current) return
        busyRef.current = true
        if (manual) setBusy(true)
        try {
          const value = await load()
          if (!aliveRef.current) return
          const summary = describeBalance(value, baselineRef.current)
          setText(summary.text)
          setSignedOut(summary.signedOut === true)
          setFailed(false)
        } catch (error) {
          if (!aliveRef.current) return
          setText('余额：读取失败')
          setSignedOut(false)
          setFailed(true)
          console.warn('[dsh-furina] balance read failed', error)
        } finally {
          busyRef.current = false
          if (aliveRef.current) setBusy(false)
        }
      }, [load])

      React.useEffect(() => {
        aliveRef.current = true
        void refresh(false)
        const timer = setInterval(() => { void refresh(false) }, POLL_MS)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [refresh])

      return h('div', {
        id: 'dsh-furina-balance',
        role: 'status',
        'aria-live': 'polite',
        title: signedOut
          ? '登录 DeepSeek 账号后自动显示余额'
          : failed
            ? '余额读取失败，点击 ⟳ 重试'
            : '每 5 分钟自动刷新，点击 ⟳ 立即刷新',
        style: {
          position: 'fixed',
          top: 'var(--dsh-frame-overlay-top, 12px)',
          right: 14,
          zIndex: 2147483000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: 'min(620px, calc(100vw - 28px))',
          padding: '5px 9px',
          borderRadius: 999,
          background: 'rgba(12, 17, 28, .62)',
          border: '1px solid rgba(255, 255, 255, .14)',
          color: '#e7effb',
          font: '12px "Segoe UI", "Microsoft YaHei", sans-serif',
          backdropFilter: 'blur(6px)',
          pointerEvents: 'auto',
          whiteSpace: 'nowrap',
        },
      },
      h('span', {
        style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
      }, text),
      h('button', {
        type: 'button',
        title: '立即刷新余额（每 5 分钟自动刷新一次）',
        'aria-label': '刷新余额',
        disabled: busy,
        onClick: () => { void refresh(true) },
        style: {
          flex: 'none',
          width: 20,
          height: 20,
          padding: 0,
          border: 'none',
          borderRadius: 999,
          background: 'rgba(255, 255, 255, .12)',
          color: '#e7effb',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.55 : 1,
          fontSize: 12,
          lineHeight: '18px',
        },
      }, '⟳'))
    }

    const settingsCardStyle = {
      padding: 14,
      border: '1px solid var(--dsw-alias-border-l3)',
      borderRadius: 10,
      background: 'var(--dsw-alias-bg-module-platform, rgba(255, 255, 255, .04))',
    }
    const settingsPrimaryButtonStyle = {
      padding: '6px 12px',
      border: '1px solid var(--dsw-alias-border-l4)',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-module-platform, rgba(255, 255, 255, .08))',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 12,
      cursor: 'pointer',
    }
    const settingsSecondaryButtonStyle = {
      ...settingsPrimaryButtonStyle,
      background: 'transparent',
    }

    /** Human-readable upload size for the customization cards. */
    function formatBytes(value) {
      const bytes = Number(value)
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    /** Settings section: choose or reset the boot movie and the wallpaper. */
    function FurinaSettings({ t }) {
      const tr = typeof t === 'function' ? t : (key) => key
      const [info, setInfo] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')
      const revision = useMediaRevision()
      const videoInput = React.useRef(null)
      const imageInput = React.useRef(null)
      const alive = React.useRef(true)

      React.useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(`${ASSET_BASE}/media-info`, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const value = await response.json()
          if (alive.current) setInfo(value)
        } catch (cause) {
          if (alive.current) setError(tr('loadFailed'))
          console.warn('[dsh-furina] media info failed', cause)
        }
      }, [])

      React.useEffect(() => { void load() }, [load])

      const upload = async (kind, file) => {
        if (file === null || file === undefined) return
        setBusy(kind)
        setNotice('')
        setError('')
        try {
          let type = typeof file.type === 'string' ? file.type : ''
          if (kind === 'boot' && !/^video\/(mp4|webm)$/.test(type)) {
            type = /\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4'
          }
          if (kind === 'background' && !/^image\/(jpeg|png|webp|gif|bmp)$/.test(type)) {
            type = /\.png$/i.test(file.name) ? 'image/png'
              : /\.webp$/i.test(file.name) ? 'image/webp'
                : /\.gif$/i.test(file.name) ? 'image/gif'
                  : /\.bmp$/i.test(file.name) ? 'image/bmp'
                    : 'image/jpeg'
          }
          const response = await fetch(`${MEDIA_BASE}/${kind}`, {
            method: 'POST',
            headers: {
              'content-type': type,
              'x-file-name': encodeURIComponent(file.name),
            },
            body: file,
          })
          const value = await response.json().catch(() => ({}))
          if (!response.ok || value.ok !== true) throw new Error(value.error || `HTTP ${response.status}`)
          if (!alive.current) return
          setNotice(tr('updated'))
          await load()
          bumpMediaRevision()
          if (kind === 'boot') replayBoot()
        } catch (cause) {
          if (alive.current) setError(String(cause !== null && typeof cause === 'object' && 'message' in cause ? cause.message : cause))
        } finally {
          if (alive.current) setBusy(null)
        }
      }

      const reset = async (kind) => {
        setBusy(kind)
        setNotice('')
        setError('')
        try {
          const response = await fetch(`${MEDIA_BASE}/${kind}`, { method: 'DELETE' })
          const value = await response.json().catch(() => ({}))
          if (!response.ok || value.ok !== true) throw new Error(value.error || `HTTP ${response.status}`)
          if (!alive.current) return
          setNotice(tr('resetDone'))
          await load()
          bumpMediaRevision()
        } catch (cause) {
          if (alive.current) setError(String(cause !== null && typeof cause === 'object' && 'message' in cause ? cause.message : cause))
        } finally {
          if (alive.current) setBusy(null)
        }
      }

      const entryLine = (entry) => {
        if (entry === undefined || entry === null) return tr('loading')
        const source = entry.source === 'custom' ? tr('customSource') : tr('defaultSource')
        return `${source} · ${entry.name} · ${formatBytes(entry.size)}`
      }

      const card = (kind, title, hint, inputRef, accept) => h('div', { style: settingsCardStyle },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, title),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, hint),
        ),
        h('div', {
          style: { marginTop: 10, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
        }, entryLine(info?.[kind])),
        kind === 'background' && info?.background !== undefined
          ? h('img', {
              key: `${revision}-${info.background.updatedAt}`,
              src: `${MEDIA_BASE}/background?v=${revision}`,
              alt: '',
              style: {
                display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover',
                marginTop: 10, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l3)',
              },
            })
          : null,
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 } },
          h('button', {
            type: 'button',
            style: settingsPrimaryButtonStyle,
            disabled: busy !== null,
            onClick: () => { inputRef.current?.click() },
          }, busy === kind ? tr('uploading') : kind === 'boot' ? tr('chooseVideo') : tr('chooseImage')),
          h('button', {
            type: 'button',
            style: settingsSecondaryButtonStyle,
            disabled: busy !== null || info?.[kind]?.source !== 'custom',
            onClick: () => { void reset(kind) },
          }, tr('reset')),
          kind === 'boot'
            ? h('button', {
                type: 'button',
                style: settingsSecondaryButtonStyle,
                disabled: busy !== null,
                onClick: () => { replayBoot() },
              }, tr('preview'))
            : null,
        ),
        h('input', {
          ref: inputRef,
          type: 'file',
          accept,
          style: { display: 'none' },
          onChange: (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void upload(kind, file)
          },
        }),
      )

      return h('section', {
        'aria-label': tr('sectionTitle'),
        style: { display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 0 10px' },
      },
      h('div', null,
        h('h2', {
          style: { margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
        }, tr('sectionTitle')),
        h('p', {
          style: { margin: '6px 0 0', fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 },
        }, tr('sectionHint')),
      ),
      card('boot', tr('bootTitle'), tr('bootHint'), videoInput, 'video/mp4,video/webm,.mp4,.webm'),
      card('background', tr('backgroundTitle'), tr('backgroundHint'), imageInput,
        'image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp'),
      notice !== '' ? h('div', {
        style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      }, notice) : null,
      error !== '' ? h('div', {
        style: { fontSize: 12, color: 'var(--dsw-alias-label-warning, #f0b36b)' },
      }, error) : null,
      )
    }

    /**
     * Ask the Host account Remote for the current wallet snapshot using the
     * same request identity the Settings account panel sends.
     * @param ctx - client plugin context.
     * @returns the balance outcome, or null when signed out.
     */
    async function readBalance(ctx) {
      const boot = window.__DSH_BOOT__
      const version = boot?.release?.version ?? '0.0.0'
      let locale = 'zh-CN'
      try {
        const snapshot = ctx.locale.getSnapshot()
        if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.active === 'string') {
          locale = snapshot.active
        }
      } catch (_error) { /* fall back to the document language below */ }
      if (locale === 'zh-CN' && typeof document !== 'undefined' && document.documentElement.lang) {
        locale = document.documentElement.lang
      }
      const metadata = {
        version,
        locale,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }
      const result = await ctx.remote.account.getBalance(metadata)
      if (result === null || typeof result !== 'object' || result.ok !== true) {
        const reason = result?.error?.message ?? result?.error?.code ?? 'account balance unavailable'
        throw new Error(reason)
      }
      return result.value
    }

    return {
      // The wallpaper and movie need only the slot table; the balance chip
      // additionally waits for the optional account Remote services below.
      inject: ['slots', 'locale'],
      apply(ctx) {
        const zh = {
          navLabel: '桌面装饰',
          sectionTitle: '桌面装饰',
          sectionHint: '自定义开机动画和背景。文件保存在本机，重启后仍然生效。',
          bootTitle: '开机动画',
          bootHint: '支持 MP4 / WebM，最大 300 MB。每次刷新页面或点击“预览播放”时播放。',
          backgroundTitle: '背景',
          backgroundHint: '支持 JPG / PNG / WebP / GIF / BMP，最大 50 MB。',
          defaultSource: '默认素材',
          customSource: '自定义',
          chooseVideo: '选择视频',
          chooseImage: '选择背景',
          reset: '恢复默认',
          preview: '预览播放',
          uploading: '正在上传…',
          loading: '读取中…',
          updated: '已更新，立即生效。',
          resetDone: '已恢复默认素材。',
          loadFailed: '读取素材信息失败。',
        }
        const en = {
          navLabel: 'Desktop decoration',
          sectionTitle: 'Desktop decoration',
          sectionHint: 'Choose your own startup movie and wallpaper. Files are stored on this machine and survive restarts.',
          bootTitle: 'Startup movie',
          bootHint: 'MP4 or WebM, up to 300 MB. Plays on page load and from “Preview”.',
          backgroundTitle: 'Background',
          backgroundHint: 'JPG, PNG, WebP, GIF, or BMP, up to 50 MB.',
          defaultSource: 'Default',
          customSource: 'Custom',
          chooseVideo: 'Choose video',
          chooseImage: 'Choose background',
          reset: 'Restore default',
          preview: 'Preview',
          uploading: 'Uploading…',
          loading: 'Loading…',
          updated: 'Updated. The new media is live.',
          resetDone: 'Default media restored.',
          loadFailed: 'Could not read media information.',
        }
        ctx.effect(() => ctx.locale.register('dsh-furina', { zh, en }), 'furina: dictionaries')
        const t = ctx.locale.bind('dsh-furina')

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-furina-background',
          order: -1000,
        }, Background))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-furina-wallpaper',
          order: 100,
        }, WallpaperTint))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-furina-boot',
          order: 2000,
        }, BootOverlay))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-furina',
          order: 40,
          label: () => t('navLabel'),
          locale: 'dsh-furina',
        }, FurinaSettings))

        ctx.inject(['remote', 'remote.account', 'remoteAccess'], (accountCtx) => {
          accountCtx.remoteAccess.whenAccess('account/watch', () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-furina-balance',
            order: 1500,
            inject: () => ({ load: () => readBalance(accountCtx) }),
          }, BalanceChip)))
        })
      },
    }
  },
})
