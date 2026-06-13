import type { LocalReview } from '$lib/types.js'

// ── Constants ──────────────────────────────────────────────────────────────────

export const SLIDER_KEYS = [
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

function _badgeIcon(paths: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

export interface BadgeDef {
    id:       string
    label:    string
    color:    string
    icon:     string
    hasCount?: boolean
}

export const BADGES: BadgeDef[] = [
    { id: 'comfortGame',     label: 'Comfort Game',      color: '#e8975a', icon: _badgeIcon(`<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>`) },
    { id: 'replayed',        label: 'Replayed',          color: '#5ab4e8', icon: _badgeIcon(`<path d="m2 9 3-3 3 3"/><path d="M13 18H7a4 4 0 0 1-4-4V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a4 4 0 0 1 4 4v8"/>`), hasCount: true },
    { id: 'hiddenGem',       label: 'Hidden Gem',        color: '#4ecb8d', icon: _badgeIcon(`<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>`) },
    { id: 'didntLiveUp',     label: "Didn't Live Up",    color: '#e85a6e', icon: _badgeIcon(`<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>`) },
    { id: 'surprisedMe',     label: 'Surprised Me',      color: '#a35ae8', icon: _badgeIcon(`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`) },
    { id: 'soulsLike',       label: 'Souls-like',        color: '#c0392b', icon: _badgeIcon(`<path d="M12 2a9 9 0 0 0-9 9 8.87 8.87 0 0 0 2.1 5.66A5 5 0 0 0 9 20v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1a5 5 0 0 0 3.9-3.34A8.87 8.87 0 0 0 21 11a9 9 0 0 0-9-9"/><path d="M9 17v1"/><path d="M15 17v1"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>`) },
    { id: 'rogueLike',       label: 'Rogue-like',        color: '#e67e22', icon: _badgeIcon(`<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.5 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.7l-.5-.8"/><path d="m18 14 4 4-4 4"/>`) },
    { id: 'survivor',        label: 'Survivor',          color: '#27ae60', icon: _badgeIcon(`<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>`) },
    { id: 'handheld',        label: 'Great Handheld',    color: '#00bcd4', icon: _badgeIcon(`<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>`) },
    { id: 'coop',            label: 'Co-op',             color: '#f1c40f', icon: _badgeIcon(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`) },
    { id: 'completionist',   label: '100%',              color: '#c0ca33', icon: _badgeIcon(`<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`) },
    { id: 'modded',          label: 'Modded',            color: '#78909c', icon: _badgeIcon(`<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`) },
    { id: 'rageQuit',        label: 'Rage Quit',         color: '#ff1744', icon: _badgeIcon(`<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>`) },
    { id: 'watershed',       label: 'Watershed',         color: '#1976d2', icon: _badgeIcon(`<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>`) },
    { id: 'thoughtProvoking',label: 'Thought Provoking', color: '#651fff', icon: _badgeIcon(`<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>`) },
    { id: 'goodGrind',       label: 'Good Grind',        color: '#ff6d00', icon: _badgeIcon(`<path d="M12 12c-2-2.5-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.5 6-4z"/><path d="M12 12c2 2.5 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.5-6 4z"/>`) },
    { id: 'contentPadded',   label: 'Content Padded',    color: '#8d6e63', icon: _badgeIcon(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`) },
    { id: 'trash',           label: 'Trash',             color: '#546e7a', icon: _badgeIcon(`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`) },
    { id: 'political',       label: 'Political',         color: '#e040fb', icon: _badgeIcon(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`) },
]

// ── openReviewModal ────────────────────────────────────────────────────────────

export function openReviewModal(appid: number | string, gameName: string, existing: LocalReview | null = null): Promise<LocalReview | null> {
    return new Promise(resolve => {
        let selectedStars = existing?.stars ?? 0
        const sliderVals: Record<string, number> = {}
        for (const { key } of SLIDER_KEYS) {
            sliderVals[key] = (existing?.ratings?.[key] ?? 5) as number
        }
        const activeTags = new Set<string>(existing?.tags ?? [])
        const customTags = new Set<string>(
            (existing?.tags ?? []).filter(t => !PRESET_TAGS.includes(t))
        )
        const badgeVals: Record<string, boolean | number> = {}
        for (const b of BADGES) {
            badgeVals[b.id] = existing?.badges?.[b.id] ?? (b.hasCount ? 0 : false)
        }

        const overlay = document.createElement('div')
        overlay.className = 'rev-modal-overlay'

        const modal = document.createElement('div')
        modal.className = 'rev-modal'
        modal.setAttribute('role', 'dialog')
        modal.setAttribute('aria-modal', 'true')

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

        const body = document.createElement('div')
        body.className = 'rev-modal-body'

        // Stars section
        const starsSection = document.createElement('div')
        const starsLabel = document.createElement('span')
        starsLabel.className = 'rev-modal-section-label'
        starsLabel.textContent = 'Rating'
        const starsRow = document.createElement('div')
        starsRow.className = 'rev-stars'
        const starBtns: HTMLButtonElement[] = []
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
                starBtns[i].classList.toggle('rev-star--active', (i + 1) <= selectedStars)
            }
            starRatingLabel.textContent = STAR_LABELS[selectedStars] ?? 'Not Rated'
        }

        starsRow.addEventListener('click', e => {
            const btn = (e.target as Element).closest('.rev-star') as HTMLElement | null
            if (!btn) return
            const clicked = Number(btn.dataset.star)
            selectedStars = clicked === selectedStars ? 0 : clicked
            _updateStars()
        })
        _updateStars()

        // Sliders section
        const slidersSection = document.createElement('div')
        const slidersLabel = document.createElement('span')
        slidersLabel.className = 'rev-modal-section-label'
        slidersLabel.textContent = 'Characteristics'
        const slidersList = document.createElement('div')
        slidersList.className = 'rev-sliders'

        for (const { key, label } of SLIDER_KEYS) {
            const row = document.createElement('div')
            row.className = 'rev-slider-row'
            const lbl = document.createElement('span')
            lbl.className = 'rev-slider-label'
            lbl.textContent = label
            const input = document.createElement('input')
            input.type = 'range'
            input.className = 'rev-slider'
            input.min = '0'; input.max = '10'; input.step = '1'
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
            row.appendChild(lbl); row.appendChild(input); row.appendChild(valEl)
            slidersList.appendChild(row)
        }
        slidersSection.appendChild(slidersLabel)
        slidersSection.appendChild(slidersList)

        // Tags section
        const tagsSection = document.createElement('div')
        const tagsLabel = document.createElement('span')
        tagsLabel.className = 'rev-modal-section-label'
        tagsLabel.textContent = 'Tags'
        const tagsWrap = document.createElement('div')
        tagsWrap.className = 'rev-tags'
        const tagBtnMap = new Map<string, HTMLButtonElement>()

        function _addPresetTag(tagText: string) {
            const btn = document.createElement('button')
            btn.className = 'rev-tag' + (activeTags.has(tagText) ? ' rev-tag--active' : '')
            btn.textContent = tagText
            btn.addEventListener('click', () => {
                if (activeTags.has(tagText)) { activeTags.delete(tagText); btn.classList.remove('rev-tag--active') }
                else { activeTags.add(tagText); btn.classList.add('rev-tag--active') }
            })
            tagBtnMap.set(tagText, btn)
            tagsWrap.appendChild(btn)
        }
        for (const t of PRESET_TAGS) _addPresetTag(t)
        for (const t of customTags) _addCustomTagPill(t)

        function _addCustomTagPill(tagText: string): HTMLButtonElement {
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
                activeTags.delete(tagText); customTags.delete(tagText); btn.remove()
            })
            activeTags.add(tagText)
            tagsWrap.appendChild(btn)
            return btn
        }

        const customRow = document.createElement('div')
        customRow.className = 'rev-tag-custom-row'
        const customInput = document.createElement('input')
        customInput.type = 'text'; customInput.className = 'rev-tag-custom-input'
        customInput.placeholder = 'Custom tag…'; customInput.maxLength = 40
        const addBtn = document.createElement('button')
        addBtn.className = 'rev-tag-add-btn'; addBtn.textContent = 'Add'

        function _addCustom() {
            const val = customInput.value.trim()
            if (!val) return
            if (activeTags.has(val)) { customInput.value = ''; return }
            if (PRESET_TAGS.includes(val)) {
                activeTags.add(val)
                tagBtnMap.get(val)?.classList.add('rev-tag--active')
            } else {
                customTags.add(val); _addCustomTagPill(val)
            }
            customInput.value = ''
        }
        addBtn.addEventListener('click', _addCustom)
        customInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _addCustom() } })
        customRow.appendChild(customInput); customRow.appendChild(addBtn)
        tagsSection.appendChild(tagsLabel); tagsSection.appendChild(tagsWrap); tagsSection.appendChild(customRow)

        // Badges section
        const badgesSection = document.createElement('div')
        const badgesLabel = document.createElement('span')
        badgesLabel.className = 'rev-modal-section-label'; badgesLabel.textContent = 'Badges'
        const badgesPicker = document.createElement('div')
        badgesPicker.className = 'rev-badge-picker'

        for (const b of BADGES) {
            const card = document.createElement('button')
            card.type = 'button'
            card.className = 'rev-badge-pick' + (badgeVals[b.id] ? ' rev-badge-pick--active' : '')
            card.style.setProperty('--badge-clr', b.color)
            const circleEl = document.createElement('div')
            circleEl.className = 'rev-badge-pick-circle'; circleEl.innerHTML = b.icon
            const labelEl = document.createElement('span')
            labelEl.className = 'rev-badge-pick-label'; labelEl.textContent = b.label
            card.appendChild(circleEl); card.appendChild(labelEl)

            if (b.hasCount) {
                const countRow = document.createElement('div')
                countRow.className = 'rev-badge-pick-count'
                countRow.hidden = badgeVals[b.id] === 0
                const minusBtn = document.createElement('button')
                minusBtn.type = 'button'; minusBtn.className = 'rev-badge-count-btn'; minusBtn.textContent = '−'
                const countEl = document.createElement('span')
                countEl.className = 'rev-badge-count-val'
                countEl.textContent = String(Math.max(1, badgeVals[b.id] as number))
                const plusBtn = document.createElement('button')
                plusBtn.type = 'button'; plusBtn.className = 'rev-badge-count-btn'; plusBtn.textContent = '+'
                countRow.appendChild(minusBtn); countRow.appendChild(countEl); countRow.appendChild(plusBtn)
                card.appendChild(countRow)
                minusBtn.addEventListener('click', e => {
                    e.stopPropagation()
                    if ((badgeVals[b.id] as number) > 1) { badgeVals[b.id] = (badgeVals[b.id] as number) - 1; countEl.textContent = String(badgeVals[b.id]) }
                })
                plusBtn.addEventListener('click', e => {
                    e.stopPropagation()
                    badgeVals[b.id] = (badgeVals[b.id] as number) + 1; countEl.textContent = String(badgeVals[b.id])
                })
                card.addEventListener('click', () => {
                    badgeVals[b.id] = (badgeVals[b.id] as number) > 0 ? 0 : (Number(countEl.textContent) || 1)
                    card.classList.toggle('rev-badge-pick--active', (badgeVals[b.id] as number) > 0)
                    countRow.hidden = badgeVals[b.id] === 0
                })
            } else {
                card.addEventListener('click', () => {
                    badgeVals[b.id] = !badgeVals[b.id]
                    card.classList.toggle('rev-badge-pick--active', !!badgeVals[b.id])
                })
            }
            badgesPicker.appendChild(card)
        }
        badgesSection.appendChild(badgesLabel); badgesSection.appendChild(badgesPicker)

        // Review text section
        const reviewSection = document.createElement('div')
        const reviewLabel = document.createElement('span')
        reviewLabel.className = 'rev-modal-section-label'; reviewLabel.textContent = 'My Review'
        const textarea = document.createElement('textarea')
        textarea.className = 'rev-textarea'; textarea.rows = 8
        textarea.placeholder = 'Write your thoughts on this game…'
        textarea.value = existing?.review ?? ''
        reviewSection.appendChild(reviewLabel); reviewSection.appendChild(textarea)

        body.appendChild(starsSection); body.appendChild(slidersSection)
        body.appendChild(badgesSection); body.appendChild(tagsSection); body.appendChild(reviewSection)

        const footer = document.createElement('div')
        footer.className = 'rev-modal-footer'
        const errorEl = document.createElement('span')
        errorEl.className = 'rev-footer-error'
        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'rev-cancel-btn'; cancelBtn.textContent = 'Cancel'
        const saveBtn = document.createElement('button')
        saveBtn.className = 'rev-save-btn'; saveBtn.textContent = 'Save Review'
        footer.appendChild(errorEl); footer.appendChild(cancelBtn); footer.appendChild(saveBtn)

        modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer)
        overlay.appendChild(modal)

        function _close(result: LocalReview | null) {
            overlay.remove()
            document.removeEventListener('keydown', _onKey)
            resolve(result)
        }
        function _onKey(e: KeyboardEvent) { if (e.key === 'Escape') _close(null) }
        overlay.addEventListener('click', e => { if (e.target === overlay) _close(null) })
        closeBtn.addEventListener('click', () => _close(null))
        cancelBtn.addEventListener('click', () => _close(null))
        document.addEventListener('keydown', _onKey)

        saveBtn.addEventListener('click', async () => {
            errorEl.textContent = ''
            saveBtn.disabled = true; saveBtn.textContent = 'Saving…'
            const ratings: Record<string, number> = {}
            for (const { key } of SLIDER_KEYS) ratings[key] = sliderVals[key]
            const payload = {
                stars:  selectedStars, ratings,
                tags:   [...activeTags],
                notes:  existing?.notes ?? [],
                review: textarea.value.trim(),
                badges: { ...badgeVals },
            }
            try {
                const res = await fetch(`/api/local-reviews/${appid}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
                    throw new Error(err.error ?? `HTTP ${res.status}`)
                }
                _close(await res.json())
            } catch (err) {
                errorEl.textContent = (err as Error).message
                saveBtn.disabled = false; saveBtn.textContent = 'Save Review'
            }
        })

        document.body.appendChild(overlay)
        ;(modal.querySelector('.rev-modal-close') as HTMLElement)?.focus()
    })
}
