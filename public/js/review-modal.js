import { escapeHtml } from './utils.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const SLIDER_KEYS = [
    { key: 'story',        label: 'Story' },
    { key: 'soundMusic',   label: 'Sound & Music' },
    { key: 'gameplay',     label: 'Gameplay' },
    { key: 'graphics',     label: 'Graphics' },
    { key: 'replayability',label: 'Replayability' },
    { key: 'performance',  label: 'Performance' },
    { key: 'agendaFree',   label: 'Agenda-Free' },
]

const PRESET_TAGS = [
    'Too Long', 'Just Right', 'Short & Sweet', 'Grindy', 'Padded',
    'Brutally Hard', 'Challenging', 'Easy', 'Relaxing', 'Great Story',
    'Weak Story', 'Great Characters', 'Addictive', 'Repetitive', 'Deep Systems',
    'Must Play', 'Hidden Gem', 'Overrated', 'Wait for Sale', 'Great OST',
    'Beautiful Visuals', 'Runs Great', 'Technical Issues', 'Better with Friends',
]

const STAR_LABELS = ['Not Rated', '1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars', 'Legendary']

// ── Helpers ────────────────────────────────────────────────────────────────────

function _starChar(index, isFilled) {
    // index 1..5 = normal stars, index 6 = legendary
    if (index === 6) return '✦'
    return isFilled ? '★' : '☆'
}

// ── openReviewModal ────────────────────────────────────────────────────────────

export function openReviewModal(appid, gameName, existing = null) {
    return new Promise(resolve => {
        // ── State ──────────────────────────────────────────────────────────────
        let selectedStars = existing?.stars ?? 0
        const sliderVals = {}
        for (const { key } of SLIDER_KEYS) {
            sliderVals[key] = existing?.ratings?.[key] ?? 5
        }
        const activeTags = new Set(existing?.tags ?? [])
        const customTags = new Set(
            (existing?.tags ?? []).filter(t => !PRESET_TAGS.includes(t))
        )

        // ── Overlay ────────────────────────────────────────────────────────────
        const overlay = document.createElement('div')
        overlay.className = 'rev-modal-overlay'

        // ── Modal box ──────────────────────────────────────────────────────────
        const modal = document.createElement('div')
        modal.className = 'rev-modal'
        modal.setAttribute('role', 'dialog')
        modal.setAttribute('aria-modal', 'true')

        // ── Header ─────────────────────────────────────────────────────────────
        const header = document.createElement('div')
        header.className = 'rev-modal-header'

        const title = document.createElement('h2')
        title.className = 'rev-modal-title'
        title.textContent = gameName

        const closeBtn = document.createElement('button')
        closeBtn.className = 'rev-modal-close'
        closeBtn.setAttribute('aria-label', 'Close')
        closeBtn.textContent = '×'

        header.appendChild(title)
        header.appendChild(closeBtn)

        // ── Body ───────────────────────────────────────────────────────────────
        const body = document.createElement('div')
        body.className = 'rev-modal-body'

        // -- Stars section ──────────────────────────────────────────────────────
        const starsSection = document.createElement('div')

        const starsLabel = document.createElement('span')
        starsLabel.className = 'rev-modal-section-label'
        starsLabel.textContent = 'Rating'

        const starsRow = document.createElement('div')
        starsRow.className = 'rev-stars'

        const starBtns = []
        for (let i = 1; i <= 6; i++) {
            const btn = document.createElement('button')
            btn.className = i === 6 ? 'rev-star rev-star--legendary' : 'rev-star'
            btn.setAttribute('aria-label', `${i === 6 ? 'Legendary' : i + ' star'}`)
            btn.dataset.star = String(i)
            btn.textContent = i === 6 ? '✦' : '★'
            starBtns.push(btn)
            starsRow.appendChild(btn)
        }

        const starRatingLabel = document.createElement('span')
        starRatingLabel.className = 'rev-star-label'

        starsRow.appendChild(starRatingLabel)
        starsSection.appendChild(starsLabel)
        starsSection.appendChild(starsRow)

        function _updateStars() {
            for (let i = 0; i < starBtns.length; i++) {
                const starNum = i + 1
                const filled = starNum <= selectedStars
                starBtns[i].classList.toggle('rev-star--active', filled)
            }
            starRatingLabel.textContent = STAR_LABELS[selectedStars] ?? 'Not Rated'
        }

        starsRow.addEventListener('click', e => {
            const btn = e.target.closest('.rev-star')
            if (!btn) return
            const clicked = Number(btn.dataset.star)
            if (clicked === selectedStars) {
                selectedStars = 0
            } else {
                selectedStars = clicked
            }
            _updateStars()
        })

        _updateStars()

        // -- Characteristics section ────────────────────────────────────────────
        const slidersSection = document.createElement('div')

        const slidersLabel = document.createElement('span')
        slidersLabel.className = 'rev-modal-section-label'
        slidersLabel.textContent = 'Characteristics'

        const slidersList = document.createElement('div')
        slidersList.className = 'rev-sliders'

        const sliderEls = {}
        const valEls = {}

        for (const { key, label } of SLIDER_KEYS) {
            const row = document.createElement('div')
            row.className = 'rev-slider-row'

            const lbl = document.createElement('span')
            lbl.className = 'rev-slider-label'
            lbl.textContent = label

            const input = document.createElement('input')
            input.type = 'range'
            input.className = 'rev-slider'
            input.min = '0'
            input.max = '10'
            input.step = '1'
            input.value = String(sliderVals[key])
            input.dataset.key = key

            const valEl = document.createElement('span')
            valEl.className = 'rev-slider-val'
            valEl.textContent = sliderVals[key] === 0 ? '—' : String(sliderVals[key])

            input.addEventListener('input', () => {
                const v = Number(input.value)
                sliderVals[key] = v
                valEl.textContent = v === 0 ? '—' : String(v)
            })

            sliderEls[key] = input
            valEls[key] = valEl

            row.appendChild(lbl)
            row.appendChild(input)
            row.appendChild(valEl)
            slidersList.appendChild(row)
        }

        slidersSection.appendChild(slidersLabel)
        slidersSection.appendChild(slidersList)

        // -- Tags section ───────────────────────────────────────────────────────
        const tagsSection = document.createElement('div')

        const tagsLabel = document.createElement('span')
        tagsLabel.className = 'rev-modal-section-label'
        tagsLabel.textContent = 'Tags'

        const tagsWrap = document.createElement('div')
        tagsWrap.className = 'rev-tags'

        const tagBtnMap = new Map()

        function _addPresetTag(tagText) {
            const btn = document.createElement('button')
            btn.className = 'rev-tag' + (activeTags.has(tagText) ? ' rev-tag--active' : '')
            btn.textContent = tagText
            btn.addEventListener('click', () => {
                if (activeTags.has(tagText)) {
                    activeTags.delete(tagText)
                    btn.classList.remove('rev-tag--active')
                } else {
                    activeTags.add(tagText)
                    btn.classList.add('rev-tag--active')
                }
            })
            tagBtnMap.set(tagText, btn)
            tagsWrap.appendChild(btn)
        }

        for (const t of PRESET_TAGS) {
            _addPresetTag(t)
        }

        // Custom tags
        for (const t of customTags) {
            _addCustomTagPill(t)
        }

        function _addCustomTagPill(tagText) {
            const btn = document.createElement('button')
            btn.className = 'rev-tag rev-tag--active'
            btn.dataset.custom = '1'

            const labelSpan = document.createElement('span')
            labelSpan.textContent = tagText

            const removeSpan = document.createElement('span')
            removeSpan.textContent = '×'
            removeSpan.style.marginLeft = '4px'
            removeSpan.style.fontWeight = '700'

            btn.appendChild(labelSpan)
            btn.appendChild(removeSpan)

            removeSpan.addEventListener('click', e => {
                e.stopPropagation()
                activeTags.delete(tagText)
                customTags.delete(tagText)
                btn.remove()
            })

            activeTags.add(tagText)
            tagsWrap.appendChild(btn)
            return btn
        }

        const customRow = document.createElement('div')
        customRow.className = 'rev-tag-custom-row'

        const customInput = document.createElement('input')
        customInput.type = 'text'
        customInput.className = 'rev-tag-custom-input'
        customInput.placeholder = 'Custom tag…'
        customInput.maxLength = 40

        const addBtn = document.createElement('button')
        addBtn.className = 'rev-tag-add-btn'
        addBtn.textContent = 'Add'

        function _addCustom() {
            const val = customInput.value.trim()
            if (!val) return
            if (activeTags.has(val)) { customInput.value = ''; return }
            // If it's a preset tag, just toggle it
            if (PRESET_TAGS.includes(val)) {
                activeTags.add(val)
                const btn = tagBtnMap.get(val)
                if (btn) btn.classList.add('rev-tag--active')
            } else {
                customTags.add(val)
                _addCustomTagPill(val)
            }
            customInput.value = ''
        }

        addBtn.addEventListener('click', _addCustom)
        customInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); _addCustom() }
        })

        customRow.appendChild(customInput)
        customRow.appendChild(addBtn)

        tagsSection.appendChild(tagsLabel)
        tagsSection.appendChild(tagsWrap)
        tagsSection.appendChild(customRow)

        // -- Review text section ────────────────────────────────────────────────
        const reviewSection = document.createElement('div')

        const reviewLabel = document.createElement('span')
        reviewLabel.className = 'rev-modal-section-label'
        reviewLabel.textContent = 'My Review'

        const textarea = document.createElement('textarea')
        textarea.className = 'rev-textarea'
        textarea.rows = 8
        textarea.placeholder = 'Write your thoughts on this game…'
        textarea.value = existing?.review ?? ''

        reviewSection.appendChild(reviewLabel)
        reviewSection.appendChild(textarea)

        // Append all sections to body
        body.appendChild(starsSection)
        body.appendChild(slidersSection)
        body.appendChild(tagsSection)
        body.appendChild(reviewSection)

        // ── Footer ─────────────────────────────────────────────────────────────
        const footer = document.createElement('div')
        footer.className = 'rev-modal-footer'

        const errorEl = document.createElement('span')
        errorEl.className = 'rev-footer-error'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'rev-cancel-btn'
        cancelBtn.textContent = 'Cancel'

        const saveBtn = document.createElement('button')
        saveBtn.className = 'rev-save-btn'
        saveBtn.textContent = 'Save Review'

        footer.appendChild(errorEl)
        footer.appendChild(cancelBtn)
        footer.appendChild(saveBtn)

        // ── Assemble ───────────────────────────────────────────────────────────
        modal.appendChild(header)
        modal.appendChild(body)
        modal.appendChild(footer)
        overlay.appendChild(modal)

        // ── Close helpers ──────────────────────────────────────────────────────
        function _close(result) {
            overlay.remove()
            document.removeEventListener('keydown', _onKey)
            resolve(result)
        }

        function _onKey(e) {
            if (e.key === 'Escape') _close(null)
        }

        overlay.addEventListener('click', e => {
            if (e.target === overlay) _close(null)
        })
        closeBtn.addEventListener('click', () => _close(null))
        cancelBtn.addEventListener('click', () => _close(null))
        document.addEventListener('keydown', _onKey)

        // ── Save ───────────────────────────────────────────────────────────────
        saveBtn.addEventListener('click', async () => {
            errorEl.textContent = ''
            saveBtn.disabled = true
            saveBtn.textContent = 'Saving…'

            const ratings = {}
            for (const { key } of SLIDER_KEYS) {
                ratings[key] = sliderVals[key]
            }

            const payload = {
                stars:   selectedStars,
                ratings,
                tags:    [...activeTags],
                notes:   existing?.notes ?? [],
                review:  textarea.value.trim(),
            }

            try {
                const res = await fetch(`/api/local-reviews/${appid}`, {
                    method:  'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(payload),
                })
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
                    throw new Error(err.error ?? `HTTP ${res.status}`)
                }
                const saved = await res.json()
                _close(saved)
            } catch (err) {
                errorEl.textContent = err.message
                saveBtn.disabled = false
                saveBtn.textContent = 'Save Review'
            }
        })

        document.body.appendChild(overlay)
        modal.querySelector('.rev-modal-close').focus()
    })
}

// ── renderLocalReviewCard ──────────────────────────────────────────────────────

export function renderLocalReviewCard(review, appid) {
    if (!review) return ''

    // Stars row
    let starsHtml = ''
    for (let i = 1; i <= 6; i++) {
        const filled = i <= review.stars
        if (i === 6) {
            const cls = 'rev-local-star rev-local-star--legendary' + (filled ? ' rev-local-star--active' : '')
            starsHtml += `<span class="${cls}">✦</span>`
        } else {
            const cls = 'rev-local-star' + (filled ? ' rev-local-star--active' : '')
            starsHtml += `<span class="${cls}">${filled ? '★' : '☆'}</span>`
        }
    }

    // Characteristic bars — only where value > 0
    let barsHtml = ''
    const ratings = review.ratings ?? {}
    for (const { key, label } of SLIDER_KEYS) {
        const val = ratings[key]
        if (!val || val <= 0) continue
        const pct = (val / 10) * 100
        barsHtml += `
            <div class="rev-bar-row">
                <span class="rev-bar-label">${escapeHtml(label)}</span>
                <div class="rev-bar-track">
                    <div class="rev-bar-fill" style="width:${pct}%"></div>
                </div>
                <span class="rev-bar-val">${val}</span>
            </div>`
    }

    // Tags
    let tagsHtml = ''
    if (review.tags?.length) {
        tagsHtml = `<div class="rev-tags-row">${review.tags.map(t =>
            `<span class="rev-tag-pill">${escapeHtml(t)}</span>`
        ).join('')}</div>`
    }

    // Review text
    let reviewTextHtml = ''
    if (review.review) {
        reviewTextHtml = `
            <p class="rev-review-text">${escapeHtml(review.review)}</p>
            <button class="rev-show-more">Show more</button>`
    }

    return `
        <div class="rev-local-card">
            <div class="rev-local-header">
                <div class="rev-local-stars">${starsHtml}</div>
                <button class="rev-edit-btn" data-appid="${appid}">Edit Review</button>
            </div>
            ${barsHtml ? `<div class="rev-bars">${barsHtml}</div>` : ''}
            ${tagsHtml}
            ${reviewTextHtml}
        </div>`
}
