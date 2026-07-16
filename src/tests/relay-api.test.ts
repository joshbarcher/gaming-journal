import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// $contracts resolves through the isTest alias in vite.config.js, so this
// exercises the REAL zod contract in contracts/steamGamesList.ts.
import { getSteamGamesList } from '../lib/js/relay-api.js'

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: unknown, status = 200) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.resolve(body),
    }
}

const validGame = { appid: 440, name: 'Team Fortress 2', playtime_forever: 120 }

function validPayload(games: unknown[] = [validGame]) {
    return { fetchedAt: '2026-07-15T00:00:00Z', gameCount: games.length, games }
}

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('getSteamGamesList — success paths', () => {
    it('fetches /relay/api/steam/games and returns the games array', async () => {
        fetchMock.mockResolvedValue(jsonRes(validPayload()))
        const games = await getSteamGamesList()
        expect(fetchMock).toHaveBeenCalledWith('/relay/api/steam/games')
        expect(games).toEqual([validGame])
    })

    it('accepts games with all optional fields present', async () => {
        const full = {
            ...validGame,
            img_icon_url:                'abc',
            has_community_visible_stats: true,
            playtime_windows_forever:    10,
            playtime_mac_forever:        0,
            playtime_linux_forever:      0,
            playtime_deck_forever:       5,
            playtime_disconnected:       0,
            rtime_last_played:           1700000000,
            content_descriptorids:       [1, 5],
        }
        fetchMock.mockResolvedValue(jsonRes(validPayload([full])))
        const games = await getSteamGamesList()
        expect(games[0]).toEqual(full)
    })

    it('returns an empty array for an empty games list', async () => {
        fetchMock.mockResolvedValue(jsonRes(validPayload([])))
        await expect(getSteamGamesList()).resolves.toEqual([])
    })

    it('strips unknown extra keys from games (zod strip contract)', async () => {
        fetchMock.mockResolvedValue(jsonRes(validPayload([{ ...validGame, sneaky_extra: 'x' }])))
        const games = await getSteamGamesList()
        expect(games[0]).not.toHaveProperty('sneaky_extra')
    })
})

describe('getSteamGamesList — failure paths', () => {
    it('throws "Games HTTP <status>" on a non-ok response without reading the body', async () => {
        const json = vi.fn()
        fetchMock.mockResolvedValue({ ok: false, status: 503, json })
        await expect(getSteamGamesList()).rejects.toThrow('Games HTTP 503')
        expect(json).not.toHaveBeenCalled()
    })

    it('rejects when the body is not valid JSON', async () => {
        fetchMock.mockResolvedValue({
            ok:     true,
            status: 200,
            json:   () => Promise.reject(new SyntaxError('Unexpected token <')),
        })
        await expect(getSteamGamesList()).rejects.toThrow(SyntaxError)
    })

    it('rejects on a schema mismatch instead of returning undefined (appid as string)', async () => {
        fetchMock.mockResolvedValue(jsonRes(validPayload([{ appid: '440', name: 'x', playtime_forever: 0 }])))
        await expect(getSteamGamesList()).rejects.toThrow()
    })

    it('rejects when a game is missing a required field', async () => {
        fetchMock.mockResolvedValue(jsonRes(validPayload([{ appid: 440, playtime_forever: 0 }])))
        await expect(getSteamGamesList()).rejects.toThrow()
    })

    it('rejects when the top-level games key is missing', async () => {
        fetchMock.mockResolvedValue(jsonRes({ fetchedAt: 'x', gameCount: 0 }))
        await expect(getSteamGamesList()).rejects.toThrow()
    })

    it('rejects when games is null instead of an array', async () => {
        fetchMock.mockResolvedValue(jsonRes({ fetchedAt: 'x', gameCount: 0, games: null }))
        await expect(getSteamGamesList()).rejects.toThrow()
    })

    it('rejects when the whole body is JSON null', async () => {
        fetchMock.mockResolvedValue(jsonRes(null))
        await expect(getSteamGamesList()).rejects.toThrow()
    })

    it('rejects when the body is an array instead of an object', async () => {
        fetchMock.mockResolvedValue(jsonRes([validGame]))
        await expect(getSteamGamesList()).rejects.toThrow()
    })

    it('propagates network-level rejections', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        await expect(getSteamGamesList()).rejects.toThrow('Failed to fetch')
    })
})
