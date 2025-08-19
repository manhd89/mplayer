class MPlayer {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        if (!this.container) throw new Error('Container not found');

        this.options = {
            aspectRatio: '16:9',
            ...options
        };

        this.video = document.createElement('video');
        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('preload', 'auto');
        this.video.style.width = '100%';
        this.video.style.height = '100%';
        this.video.controls = false;

        this.video.volume = localStorage.getItem('playerVolume') ? parseFloat(localStorage.getItem('playerVolume')) : 1;
        this.video.muted = localStorage.getItem('playerMuted') === 'true';

        this.container.classList.add('m-player');
        this.container.appendChild(this.video);

        this._buildUI();
        this._bindClickEvents();
        this._bindUIEvents();
        this._bindKeyboard();
        this._bindFullscreenEvents();
        this._bindSwipeEvents();

        this.hls = null;
        this._hideControlsTimeout = null;
        this._inactiveDelay = 2500;
        this._seekStep = 10;
        this._lastVolume = this.video.volume > 0 ? this.video.volume : 1;
        this._tapTimeout = null;
        this._tapCount = { left: 0, right: 0 };
        this._doubleTapMaxDelay = 300;
        this.currentSpeed = 1;
        this._speedDisplayTimeout = null;
        this._isSpeedBtnHidden = false;

        this._swipeStartX = 0;
        this._swipeStartY = 0;
        this._swipeThreshold = 50;
        this._swipeSpeedChange = false;
        this._isSwipeDown = false;

        if (this.options.src) this.load(this.options.src);

        this.volumeRange.value = this.video.muted ? 0 : this.video.volume * 100;
        this._updateVolumeBar();
        this._updateVolumeIcon();
        this._showControls();
        this._scheduleHideControls();
        this._updateProgress();
        this._updatePlayUI();
        this._updateFullscreenIcon();

        this._resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                this._handleResize(entry.contentRect);
            }
        });
        this._resizeObserver.observe(this.container);
    }

    _adsRegexList = [
        /(?<!#EXT-X-DISCONTINUITY[\s\S]*)#EXT-X-DISCONTINUITY\n(?:.*?\n){18,24}#EXT-X-DISCONTINUITY\n(?![\s\S]*#EXT-X-DISCONTINUITY)/g,
        /#EXT-X-DISCONTINUITY\n(?:#EXT-X-KEY:METHOD=NONE\n(?:.*\n){18,24})?#EXT-X-DISCONTINUITY\n|convertv7\//g,
        /#EXT-X-DISCONTINUITY\n#EXTINF:3\.920000,\n.*\n#EXTINF:0\.760000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:2\.500000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:2\.420000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:0\.780000,\n.*\n#EXTINF:1\.960000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:1\.760000,\n.*\n#EXTINF:3\.200000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:1\.360000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:2\.000000,\n.*\n#EXTINF:0\.720000,\n.*/g
    ];

    async _removeAds(url) {
        try {
            const req = await fetch(url);
            let playlist = (await req.text()).replace(/^[^#].*$/gm, l => {
                try { return new URL(l, url).href; } catch { return l; }
            });

            if (playlist.includes("#EXT-X-STREAM-INF"))
                return this._removeAds(playlist.trim().split("\n").pop());

            if (this._adsRegexList.some(r => (r.lastIndex = 0, r.test(playlist)))) {
                playlist = this._adsRegexList.reduce((p, r) => p.replaceAll(r, ""), playlist);
            }

            return URL.createObjectURL(new Blob([playlist], {
                type: req.headers.get("Content-Type") || "text/plain"
            }));
        } catch (e) {
            throw e;
        }
    }

    play() { return this.video.play(); }
    pause() { return this.video.pause(); }
    seek(seconds) { this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, seconds)); }
    setVolume(v) {
        this.video.volume = Math.max(0, Math.min(1, v));
        this.video.muted = false;
        this.volumeRange.value = this.video.volume * 100;
        if (this.video.volume > 0) {
            this._lastVolume = this.video.volume;
        }
        localStorage.setItem('playerVolume', this.video.volume);
        localStorage.setItem('playerMuted', this.video.muted);
        this._updateVolumeIcon();
        this._updateVolumeBar();
    }
    toggleMute() {
        this.video.muted = !this.video.muted;
        if (this.video.muted) {
            this._lastVolume = this.video.volume;
            this.video.volume = 0;
        } else {
            this.video.volume = this._lastVolume > 0 ? this._lastVolume : 1;
        }
        this.volumeRange.value = this.video.muted ? 0 : this.video.volume * 100;
        localStorage.setItem('playerVolume', this.video.volume);
        localStorage.setItem('playerMuted', this.video.muted);
        this._updateVolumeIcon();
        this._updateVolumeBar();
    }
    async load(src) {
        if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
        if (!src) return;

        if (src.includes('.m3u8')) {
            try {
                const cleanUrl = await this._removeAds(src);
                if (window.Hls && Hls.isSupported()) {
                    this.hls = new Hls();
                    this.hls.loadSource(cleanUrl);
                    this.hls.attachMedia(this.video);
                } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                    this.video.src = cleanUrl;
                }
            } catch (e) {
                console.error("Error loading HLS:", e);
            }
        } else {
            this.video.src = src;
        }
    }
    enterFullscreen() {
        if (this.container.requestFullscreen) {
            this.container.requestFullscreen();
        }
    }
    exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }

    _buildUI() {
        const center = document.createElement('div');
        center.className = 'center-play';
        center.innerHTML = `<button class="center-play-btn" aria-label="Play/Pause"><i class="fas fa-play"></i></button>`;
        this.container.appendChild(center);
        this.centerPlayBtn = center.querySelector('.center-play-btn');

        const loading = document.createElement('div');
        loading.className = 'loading-spinner';
        loading.innerHTML = `<div class="spinner-icon"><i class="fas fa-spinner fa-spin"></i></div>`;
        this.container.appendChild(loading);
        this.loadingSpinner = loading;

        const controls = document.createElement('div');
        controls.className = 'm-player-controls';
        controls.innerHTML = `
            <div class="progress-row">
                <div class="progress-container">
                    <input class="progress" type="range" min="0" max="100" step="0.01" value="0" />
                </div>
            </div>
            <div class="controls-row">
                <div class="controls-left">
                    <button class="btn btn-play" aria-label="Play/Pause"><i class="fas fa-play"></i></button>
                    <div class="time">00:00 / 00:00</div>
                    <span class="speed-display">1x</span>
                </div>
                <div class="controls-right">
                    <div class="speed-menu">
                        <button class="btn btn-speed" aria-label="Playback speed">1x</button>
                        <div class="speed-options">
                            <div class="speed-option" data-speed="0.5">0.5x</div>
                            <div class="speed-option" data-speed="0.75">0.75x</div>
                            <div class="speed-option active" data-speed="1">1x</div>
                            <div class="speed-option" data-speed="1.25">1.25x</div>
                            <div class="speed-option" data-speed="1.5">1.5x</div>
                            <div class="speed-option" data-speed="2">2x</div>
                        </div>
                    </div>
                    <button class="btn btn-volume" aria-label="Toggle mute"><i class="fas fa-volume-high"></i></button>
                    <input class="volume-range" type="range" min="0" max="100" step="0.01" />
                    <button class="btn btn-full" aria-label="Fullscreen"><i class="fas fa-expand"></i></button>
                </div>
            </div>
        `;
        this.container.appendChild(controls);
        this.controls = controls;
        this.progress = controls.querySelector('.progress');
        this.playBtn = controls.querySelector('.btn-play');
        this.timeText = controls.querySelector('.time');
        this.speedDisplay = controls.querySelector('.speed-display');
        this.speedBtn = controls.querySelector('.btn-speed');
        this.speedMenu = controls.querySelector('.speed-options');
        this.speedOptions = controls.querySelectorAll('.speed-option');
        this.volumeBtn = controls.querySelector('.btn-volume');
        this.volumeRange = controls.querySelector('.volume-range');
        this.fullBtn = controls.querySelector('.btn-full');

        this.volumeRange.value = this.video.muted ? 0 : this.video.volume * 100;
    }

    _togglePlayPause() {
        if (this.video.paused) {
            this.play().catch(e => {});
        } else {
            this.pause();
        }
    }

    _bindClickEvents() {
        this.container.addEventListener('click', (event) => {
            const target = event.target;

            if (target.closest('.center-play-btn')) {
                event.stopPropagation();
                this._togglePlayPause();
            } else if (target.closest('.btn-play')) {
                event.stopPropagation();
                this._togglePlayPause();
            } else if (target.closest('.btn-speed')) {
                event.stopPropagation();
                this._toggleSpeedMenu();
            } else if (target.closest('.speed-option')) {
                event.stopPropagation();
                const speed = target.closest('.speed-option').dataset.speed;
                if (speed && !isNaN(parseFloat(speed))) {
                    this._setPlaybackSpeed(speed);
                }
            } else if (target.closest('.btn-volume')) {
                event.stopPropagation();
                this.toggleMute();
            } else if (target.closest('.btn-full')) {
                event.stopPropagation();
                if (!document.fullscreenElement) {
                    this.enterFullscreen();
                } else {
                    this.exitFullscreen();
                }
            } else if (target === this.video) {
                this._togglePlayPause();
            }

            if (!target.closest('.speed-menu') && this.speedMenu.classList.contains('show')) {
                this._hideSpeedMenu();
            }
        });
    }

    _bindUIEvents() {
        this.progress.addEventListener('input', () => {
            const pct = parseFloat(this.progress.value) / 100;
            const t = (this.video.duration || 0) * pct;
            this._setTimeText(t, this.video.duration || 0);
            this._updateProgressBar(pct * 100);
        });
        this.progress.addEventListener('change', () => {
            const pct = parseFloat(this.progress.value) / 100;
            const t = (this.video.duration || 0) * pct;
            this.video.currentTime = t;
        });

        this.video.addEventListener('play', () => {
            this._updatePlayUI();
            this._scheduleHideControls();
            this._hideLoadingSpinner();
        });
        this.video.addEventListener('timeupdate', () => {
            this._updateProgress();
        });
        this.video.addEventListener('loadedmetadata', () => {
            this._setTimeText(this.video.currentTime || 0, this.video.duration || 0);
            this._updateProgress();
            this._hideLoadingSpinner();
        });
        this.video.addEventListener('pause', () => this._updatePlayUI());
        this.video.addEventListener('volumechange', () => {
            this.volumeRange.value = this.video.muted ? 0 : this.video.volume * 100;
            this._updateVolumeIcon();
            this._updateVolumeBar();
        });

        this.video.addEventListener('progress', () => this._updateProgress());
        this.video.addEventListener('waiting', () => this._showLoadingSpinner());
        this.video.addEventListener('canplay', () => this._hideLoadingSpinner());
        this.video.addEventListener('playing', () => this._hideLoadingSpinner());

        this.volumeRange.addEventListener('input', (e) => {
            this.setVolume(parseFloat(e.target.value) / 100);
        });

        ['mousemove', 'touchstart', 'touchmove'].forEach(ev => {
            this.container.addEventListener(ev, () => {
                this._showControls();
                this._scheduleHideControls();
            }, { passive: true });
        });

        if ('ontouchstart' in window) {
            this.container.addEventListener('touchend', (ev) => this._onTap(ev), { passive: false });
        } else {
            this.container.addEventListener('dblclick', (ev) => this._onDoubleClick(ev));
        }
    }

    _bindSwipeEvents() {
        this.container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1 && !e.target.closest('.m-player-controls')) {
                this._swipeStartX = e.touches[0].clientX;
                this._swipeStartY = e.touches[0].clientY;
                this._swipeSpeedChange = false;
                this._isSwipeDown = false;
            }
        }, { passive: true });

        this.container.addEventListener('touchmove', (e) => {
            if (e.target.closest('.m-player-controls') || this._swipeSpeedChange) return;

            if (e.touches.length === 1) {
                const x = e.touches[0].clientX;
                const y = e.touches[0].clientY;
                const dx = x - this._swipeStartX;
                const dy = y - this._swipeStartY;

                if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > this._swipeThreshold) {
                    e.preventDefault();
                    this._swipeSpeedChange = true;
                    if (dx < 0) {
                        this._setPlaybackSpeed(1);
                    } else {
                        this._setPlaybackSpeed(2);
                    }
                } else if (Math.abs(dy) > Math.abs(dx) && dy > this._swipeThreshold) {
                    e.preventDefault();
                    this._isSwipeDown = true;
                    this._hideControls();
                }
            }
        }, { passive: false });

        this.container.addEventListener('mousedown', (e) => {
            if (e.button === 0 && !e.target.closest('.m-player-controls')) {
                this._swipeStartX = e.clientX;
                this._swipeStartY = e.clientY;
                this._swipeSpeedChange = false;
                this._isSwipeDown = false;
            }
        });

        this.container.addEventListener('mousemove', (e) => {
            if (e.target.closest('.m-player-controls') || this._swipeSpeedChange) return;

            if (e.buttons === 1) {
                const dx = e.clientX - this._swipeStartX;
                const dy = e.clientY - this._swipeStartY;

                if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > this._swipeThreshold) {
                    this._swipeSpeedChange = true;
                    if (dx < 0) {
                        this._setPlaybackSpeed(1);
                    } else {
                        this._setPlaybackSpeed(2);
                    }
                }
            }
        });
    }

    _bindFullscreenEvents() {
        document.addEventListener('fullscreenchange', () => {
            this._updateFullscreenIcon();
        });
    }

    _setPlaybackSpeed(speed) {
        const parsedSpeed = parseFloat(speed);
        if (isNaN(parsedSpeed) || parsedSpeed <= 0) {
            return;
        }
        this.currentSpeed = parsedSpeed;
        this.video.playbackRate = this.currentSpeed;
        this.speedBtn.textContent = `${this.currentSpeed}x`;

        if (this._isSpeedBtnHidden) {
            this.speedDisplay.textContent = `${this.currentSpeed}x`;
            this._showSpeedDisplay();
            this._hideSpeedDisplay();
        } else {
            this._hideSpeedDisplay(0);
        }

        this.speedOptions.forEach(option => {
            if (parseFloat(option.dataset.speed) === this.currentSpeed) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });

        this._hideSpeedMenu();
    }

    _showSpeedDisplay() {
        clearTimeout(this._speedDisplayTimeout);
        this.speedDisplay.classList.add('show');
    }

    _hideSpeedDisplay(delay = 1500) {
        this._speedDisplayTimeout = setTimeout(() => {
            this.speedDisplay.classList.remove('show');
        }, delay);
    }

    _toggleSpeedMenu() {
        this.speedMenu.classList.toggle('show');
        if (this.speedMenu.classList.contains('show')) {
            this._showControls();
        }
    }

    _hideSpeedMenu() {
        setTimeout(() => {
            this.speedMenu.classList.remove('show');
        }, 300);
    }

    _updatePlayUI() {
        const isPaused = this.video.paused || this.video.ended;
        const playIcon = isPaused ? 'fa-play' : 'fa-pause';

        const playIconElement = this.playBtn.querySelector('i');
        if (playIconElement) {
            playIconElement.className = `fas ${playIcon}`;
        }

        const centerIconElement = this.centerPlayBtn.querySelector('i');
        if (centerIconElement) {
            centerIconElement.className = `fas ${playIcon}`;
        }
    }

    _updateVolumeIcon() {
        const volumeIcon = this.volumeBtn.querySelector('i');
        if (!volumeIcon) return;

        if (this.video.muted || this.video.volume === 0) {
            volumeIcon.className = 'fas fa-volume-mute';
        } else if (this.video.volume < 0.5) {
            volumeIcon.className = 'fas fa-volume-low';
        } else {
            volumeIcon.className = 'fas fa-volume-high';
        }
    }

    _updateVolumeBar() {
        const volumePct = this.video.muted ? 0 : this.video.volume * 100;
        this.volumeRange.value = volumePct;
        const gradient = `linear-gradient(to right,
            var(--accent-red) 0%,
            var(--accent-red) ${volumePct}%,
            rgba(255, 255, 255, 0.2) ${volumePct}%,
            rgba(255, 255, 255, 0.2) 100%
        )`;
        this.volumeRange.style.background = gradient;
    }

    _updateFullscreenIcon() {
        const fullscreenIcon = this.fullBtn.querySelector('i');
        if (!fullscreenIcon) return;

        fullscreenIcon.className = document.fullscreenElement
            ? 'fas fa-compress'
            : 'fas fa-expand';
    }

    _updateProgressBar(pct) {
    }

    _updateProgress() {
        if (!this.video.duration || isNaN(this.video.duration)) return;

        const playedPct = (this.video.currentTime / this.video.duration) * 100;
        
        let bufferedPct = 0;
        if (this.video.buffered.length > 0) {
            const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
            bufferedPct = (bufferedEnd / this.video.duration) * 100;
        }

        this.progress.value = playedPct;

        const gradient = `linear-gradient(to right,
            var(--accent-red) 0%,
            var(--accent-red) ${playedPct}%,
            rgba(255, 255, 255, 0.4) ${playedPct}%,
            rgba(255, 255, 255, 0.4) ${bufferedPct}%,
            rgba(255, 255, 255, 0.2) ${bufferedPct}%,
            rgba(255, 255, 255, 0.2) 100%
        )`;
        
        this.progress.style.background = gradient;
        this._setTimeText(this.video.currentTime, this.video.duration);
    }

    _showLoadingSpinner() {
        this.loadingSpinner.style.display = 'flex';
    }

    _hideLoadingSpinner() {
        this.loadingSpinner.style.display = 'none';
    }

    _setTimeText(current, total) {
        const fmt = t => {
            if (!t || isNaN(t) || !isFinite(t)) return '00:00';
            const hh = Math.floor(t / 3600);
            const mm = Math.floor((t % 3600) / 60);
            const ss = Math.floor(t % 60);
            if (hh > 0) return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
            return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        };
        this.timeText.textContent = `${fmt(current)} / ${fmt(total)}`;
    }

    _showControls() {
        this.container.classList.remove('hide-controls');
        this.controls.style.pointerEvents = 'auto';
        this.centerPlayBtn.style.opacity = '1';
        this.centerPlayBtn.style.transform = 'scale(1)';
        this.centerPlayBtn.style.pointerEvents = 'auto';
        if (this.speedMenu.classList.contains('show')) {
            this.speedMenu.style.pointerEvents = 'auto';
        }
    }

    _hideControls() {
        this.container.classList.add('hide-controls');
        this.controls.style.pointerEvents = 'none';
        this.centerPlayBtn.style.opacity = '0';
        this.centerPlayBtn.style.transform = 'scale(.96)';
        this.centerPlayBtn.style.pointerEvents = 'none';
    }

    _scheduleHideControls() {
        if (this._hideControlsTimeout) clearTimeout(this._hideControlsTimeout);
        this._hideControlsTimeout = setTimeout(() => {
            if (!this.video.paused && !this.speedMenu.classList.contains('show')) {
                this._hideControls();
            }
        }, this._inactiveDelay);
    }

    _handleResize(rect) {
        this._updateResponsiveLayout(rect.width);
    }

    _updateResponsiveLayout(width) {
        if (width < 520) {
            this.volumeRange.style.display = 'none';
            this.speedBtn.style.display = 'none';
            this._isSpeedBtnHidden = true;
            this.speedDisplay.style.display = 'block';
        } else {
            this.volumeRange.style.display = '';
            this.speedBtn.style.display = '';
            this._isSpeedBtnHidden = false;
            this.speedDisplay.style.display = 'none';
            this.speedDisplay.classList.remove('show');
        }
    }

    _bindKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (!document.activeElement || document.activeElement === document.body) {
                if (e.code === 'Space') { e.preventDefault(); this.video.paused ? this.play() : this.pause(); }
                if (e.code === 'ArrowRight') { this.seek(this.video.currentTime + this._seekStep); this._showSeekIndicator(this._seekStep, true); }
                if (e.code === 'ArrowLeft') { this.seek(this.video.currentTime - this._seekStep); this._showSeekIndicator(this._seekStep, false); }
                if (e.code === 'ArrowUp') { e.preventDefault(); this.setVolume(this.video.volume + 0.1); }
                if (e.code === 'ArrowDown') { e.preventDefault(); this.setVolume(this.video.volume - 0.1); }
                if (e.code === 'KeyF') {
                    if (!document.fullscreenElement) this.enterFullscreen();
                    else this.exitFullscreen();
                }
                if (e.code === 'KeyM') this.toggleMute();
                if (e.code === 'KeyS') this._toggleSpeedMenu();
                if (e.code === 'Digit1') { e.preventDefault(); this._setPlaybackSpeed(1); }
                if (e.code === 'Digit2') { e.preventDefault(); this._setPlaybackSpeed(2); }
                if (e.code === 'Digit3') { e.preventDefault(); this._setPlaybackSpeed(0.5); }
            }
        });
    }

    _onTap(ev) {
        if (ev.target.closest('.btn, .center-play-btn, .speed-menu, .speed-option') || ev.target.closest('input')) return;
        ev.preventDefault();
        const rect = this.container.getBoundingClientRect();
        const clientX = ev.changedTouches[0].clientX;
        const x = clientX - rect.left;
        const width = rect.width;
        const isLeftRegion = x < width / 3;
        const isRightRegion = x > (2 * width) / 3;

        if (this._isSwipeDown) {
            this._isSwipeDown = false;
            return;
        }

        if (this._tapTimeout) {
            clearTimeout(this._tapTimeout);
            this._tapTimeout = null;

            if (isLeftRegion) {
                this._tapCount.left++;
                this._tapCount.right = 0;
                const seekTime = this._seekStep * this._tapCount.left;
                this.seek(Math.max(0, (this.video.currentTime || 0) - this._seekStep));
                this._showSeekIndicator(seekTime, false);
                this._createRipple(ev);
            } else if (isRightRegion) {
                this._tapCount.right++;
                this._tapCount.left = 0;
                const seekTime = this._seekStep * this._tapCount.right;
                this.seek(Math.min(this.video.duration, (this.video.currentTime || 0) + this._seekStep));
                this._showSeekIndicator(seekTime, true);
                this._createRipple(ev);
            }
            this._scheduleHideControls();
        } else {
            this._tapTimeout = setTimeout(() => {
                this._tapTimeout = null;
                this._tapCount.left = 0;
                this._tapCount.right = 0;
                this._showControls();
                this._scheduleHideControls();
            }, this._doubleTapMaxDelay);
        }
    }

    _onDoubleClick(ev) {
        const rect = this.container.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const isRight = x > rect.width / 2;
        if (isRight) {
            this.seek(Math.min(this.video.duration, (this.video.currentTime || 0) + this._seekStep));
            this._showSeekIndicator(this._seekStep, true);
        } else {
            this.seek(Math.max(0, (this.video.currentTime || 0) - this._seekStep));
            this._showSeekIndicator(this._seekStep, false);
        }
        this._createRipple(ev);
        this._scheduleHideControls();
    }

    _createRipple(ev) {
        this.container.querySelectorAll('.ripple').forEach(el => el.remove());
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        const rect = this.container.getBoundingClientRect();
        const diameter = Math.max(rect.width, rect.height) * 0.5;
        const clientX = (ev.clientX || (ev.changedTouches && ev.changedTouches[0].clientX));
        const clientY = (ev.clientY || (ev.changedTouches && ev.changedTouches[0].clientY));
        if (!clientX || !clientY) return;
        const x = clientX - rect.left - diameter / 2;
        const y = clientY - rect.top - diameter / 2;
        ripple.style.width = ripple.style.height = `${diameter}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        this.container.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);
    }

    _showSeekIndicator(time, isForward) {
        this.container.querySelectorAll('.seek-indicator-container').forEach(el => el.remove());
        const container = document.createElement('div');
        container.className = `seek-indicator-container ${isForward ? 'seek-indicator-right' : 'seek-indicator-left'}`;

        const arrowContainer = document.createElement('div');
        arrowContainer.className = 'arrow-container';
        for (let i = 0; i < 3; i++) {
            const arrow = document.createElement('i');
            arrow.className = `fas fa-chevron-${isForward ? 'right' : 'left'}`;
            arrowContainer.appendChild(arrow);
        }

        const timeText = document.createElement('span');
        timeText.className = 'seek-time';
        timeText.textContent = isForward ? `+${time}s` : `−${time}s`;

        container.appendChild(arrowContainer);
        container.appendChild(timeText);
        this.container.appendChild(container);
        container.classList.add('show');

        setTimeout(() => {
            container.classList.add('animate-out');
            setTimeout(() => container.remove(), 300);
        }, 700);
    }

    destroy() {
        if (this.hls) try { this.hls.destroy(); } catch (e) {}
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this.container.removeEventListener('click', this._bindClickEvents);
        this.container.innerHTML = '';
    }
}

window.MPlayer = MPlayer;
