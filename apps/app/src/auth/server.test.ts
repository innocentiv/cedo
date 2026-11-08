import { describe, expect, spyOn, test } from 'bun:test'
import type { Instance } from '@cedo/contract'
import {
  type Fetcher,
  type ServerStore,
  addressOf,
  checkServer,
  createServerChoice,
  hostOf,
  onLocalNetwork,
  readAddress,
  startUp,
  versionNotice,
} from './server.ts'

/**
 * Which server this device talks to (#78), without React and without a network: a fake fetch and a
 * fake keychain, as `session.test.ts` has.
 */

describe('an address as a person types it', () => {
  test('is the one they open in a browser, made the API root', () => {
    expect(readAddress('cedo.example.com')).toEqual({ base: 'https://cedo.example.com/api' })
    expect(readAddress('  https://cedo.example.com/  ')).toEqual({
      base: 'https://cedo.example.com/api',
    })
    expect(readAddress('https://cedo.example.com/api/')).toEqual({
      base: 'https://cedo.example.com/api',
    })
    expect(readAddress('HTTPS://Cedo.Example.com')).toEqual({
      base: 'https://cedo.example.com/api',
    })
  })

  test('keeps a path it is served under, and drops what follows it', () => {
    expect(readAddress('example.com/cedo')).toEqual({ base: 'https://example.com/cedo/api' })
    expect(readAddress('https://example.com/?from=mail#top')).toEqual({
      base: 'https://example.com/api',
    })
  })

  /** What the deployment serves out of the box: plain HTTP on the home network's address. */
  test('without a scheme, is plain HTTP on a local address and HTTPS on any other', () => {
    expect(readAddress('192.168.1.20:8080')).toEqual({ base: 'http://192.168.1.20:8080/api' })
    expect(readAddress('nas.local:8080')).toEqual({ base: 'http://nas.local:8080/api' })
    expect(readAddress('localhost:8081')).toEqual({ base: 'http://localhost:8081/api' })
    expect(readAddress('[fd00::20]:8080')).toEqual({ base: 'http://[fd00::20]:8080/api' })
    expect(readAddress('nas.lan:8080')).toEqual({ base: 'https://nas.lan:8080/api' })
  })

  /** A token would cross the network in clear text (ADR-0032). */
  test('is refused over plain HTTP to any name but a local one', () => {
    expect(readAddress('http://192.168.1.20:8080')).toEqual({
      base: 'http://192.168.1.20:8080/api',
    })
    expect(readAddress('http://nas.local')).toEqual({ base: 'http://nas.local/api' })
    expect(readAddress('http://nas.lan:8080')).toEqual({ problem: 'insecure' })
    expect(readAddress('http://cedo.example.com')).toEqual({ problem: 'insecure' })
  })

  test('is said to be missing, or not an address at all', () => {
    expect(readAddress('   ')).toEqual({ problem: 'empty' })
    expect(readAddress('ftp://cedo.example.com')).toEqual({ problem: 'malformed' })
    expect(readAddress('not an address')).toEqual({ problem: 'malformed' })
  })

  test('is shown as its host', () => {
    expect(hostOf('https://cedo.example.com/api')).toBe('cedo.example.com')
    expect(hostOf('http://192.168.1.20:8080/api')).toBe('192.168.1.20:8080')
  })

  /** Changing server starts from the one kept, as typed — read again, it is the same server. */
  test('is given back as typed, less the API root it was made', () => {
    for (const base of [
      'https://cedo.example.com/api',
      'http://192.168.1.20:8080/api',
      'https://example.com/cedo/api',
    ]) {
      expect(readAddress(addressOf(base))).toEqual({ base })
    }
    expect(addressOf('https://example.com/cedo/api')).toBe('https://example.com/cedo')
  })
})

describe('an address on the local network', () => {
  /** Where iOS asks for local network access, so "can't reach" says where to allow it. */
  test('is a private address or a .local name', () => {
    for (const base of [
      'http://192.168.1.20:8080/api',
      'http://10.0.0.5/api',
      'http://172.20.1.1/api',
      'http://169.254.10.1/api',
      'http://nas.local/api',
      'http://[fd00::20]:8080/api',
      'http://[fe80::1]/api',
    ]) {
      expect(onLocalNetwork(base)).toBe(true)
    }
  })

  test('is not this device, a VPN address, or the internet', () => {
    for (const base of [
      'http://localhost:8081/api',
      'http://127.0.0.1:3000/api',
      'http://100.101.102.103/api',
      'http://172.32.0.1/api',
      'https://cedo.example.com/api',
    ]) {
      expect(onLocalNetwork(base)).toBe(false)
    }
  })
})

const INSTANCE: Instance = { product: 'cedo', version: '0.1.0', signUp: 'closed' }

/** A fetch that answers `body` with `status`, from `url` if it was redirected there. */
function answering(body: unknown, status = 200, url?: string): Fetcher & { asked: string[] } {
  const asked: string[] = []
  const fetcher = async (requested: string) => {
    asked.push(requested)
    const response = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })
    if (url !== undefined) Object.defineProperty(response, 'url', { value: url })
    return response
  }
  return Object.assign(fetcher, { asked })
}

describe('a server, checked', () => {
  test('is cedo when /instance says so, and that is what is asked', async () => {
    const fetcher = answering(INSTANCE)
    expect(await checkServer('https://cedo.example.com/api', fetcher)).toEqual({
      kind: 'cedo',
      base: 'https://cedo.example.com/api',
    })
    expect(fetcher.asked).toEqual(['https://cedo.example.com/api/instance'])
  })

  /**
   * Known by its product alone: a later server that says more, or says sign-up another way, is still
   * cedo. Refusing it would refuse on a version, which ADR-0032 rules out.
   */
  test('is cedo by its product, whatever else a later version says', async () => {
    const later = answering({ product: 'cedo', version: '2.0.0', signUp: 'invited', motd: 'hi' })
    expect(await checkServer('https://cedo.example.com/api', later)).toEqual({
      kind: 'cedo',
      base: 'https://cedo.example.com/api',
    })
  })

  /** Typed bare, a .local name is plain HTTP; one that serves HTTPS is kept on HTTPS. */
  test('is kept on HTTPS when it moves the request there, on the same host', async () => {
    const upgraded = answering(INSTANCE, 200, 'https://nas.local/api/instance')
    expect(await checkServer('http://nas.local/api', upgraded)).toEqual({
      kind: 'cedo',
      base: 'https://nas.local/api',
    })
  })

  /** "Can't reach your server" is kept apart from "Not a cedo server", as Jellyfin's app does. */
  test('is unreachable when nothing answers, and says whether it is on the local network', async () => {
    const offline: Fetcher = async () => {
      throw new TypeError('Network request failed')
    }
    expect(await checkServer('http://192.168.1.20:8080/api', offline)).toEqual({
      kind: 'unreachable',
      onLocalNetwork: true,
    })
    expect(await checkServer('https://cedo.example.com/api', offline)).toEqual({
      kind: 'unreachable',
      onLocalNetwork: false,
    })
  })

  test('is unreachable when it does not answer in time', async () => {
    const silent: Fetcher = async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    expect(await checkServer('https://cedo.example.com/api', silent, 10)).toEqual({
      kind: 'unreachable',
      onLocalNetwork: false,
    })
  })

  test('is unreachable when the server behind its proxy is down', async () => {
    expect(
      await checkServer('https://cedo.example.com/api', answering('Bad Gateway', 502)),
    ).toEqual({ kind: 'unreachable', onLocalNetwork: false })
  })

  test('is not cedo when /instance is missing, or answers something else', async () => {
    const base = 'https://media.example.com/api'
    for (const fetcher of [
      answering('<html>Not found</html>', 404),
      answering('<html>Welcome</html>'),
      answering({ product: 'jellyfin', version: '10.10.0', signUp: 'open' }),
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- each answer in turn.
      expect(await checkServer(base, fetcher)).toEqual({ kind: 'not-cedo' })
    }
  })

  /** A token is sent only to the server it was given to: a redirect to another host is not followed. */
  test('is elsewhere when it sends the request to another host', async () => {
    const fetcher = answering(INSTANCE, 200, 'https://other.example.net/api/instance')
    expect(await checkServer('https://cedo.example.com/api', fetcher)).toEqual({
      kind: 'elsewhere',
      host: 'other.example.net',
    })
  })
})

describe('the app and its server, by version', () => {
  test('are said nothing of when they are the same', () => {
    expect(versionNotice('0.3.0', '0.3.0')).toBeNull()
  })

  test('name the side to update: the older', () => {
    expect(versionNotice('0.3.0', '0.4.0')).toEqual({
      app: '0.3.0',
      server: '0.4.0',
      update: 'app',
    })
    expect(versionNotice('0.10.0', '0.9.2')).toEqual({
      app: '0.10.0',
      server: '0.9.2',
      update: 'server',
    })
  })

  test('name neither when the numbers do not say which is older', () => {
    expect(versionNotice('0.3.0', 'nightly')).toEqual({
      app: '0.3.0',
      server: 'nightly',
      update: 'either',
    })
  })
})

/** A keychain holding `base`, recording what is written to it and when. */
function aStore(base: string | null, log: string[]): ServerStore & { held: () => string | null } {
  let held = base
  return {
    held: () => held,
    read: async () => held,
    write: async (next) => {
      log.push(`server ${next}`)
      held = next
    },
    clear: async () => {
      log.push('server cleared')
      held = null
    },
  }
}

/** For a test where no sign-in is kept, so there is nothing to forget. */
async function forgetNothing(): Promise<void> {
  // Nothing kept.
}

/** A server choice over `store`, logging the sign-in forgotten, asking `fetcher`. */
function aChoice(store: ServerStore, log: string[], fetcher: Fetcher = answering(INSTANCE)) {
  return createServerChoice({
    store,
    fetcher,
    forgetSignIn: async () => {
      log.push('sign-in forgotten')
    },
  })
}

describe('the server this device keeps', () => {
  test('is the one stored, once read', async () => {
    const choice = createServerChoice({
      store: aStore('https://cedo.example.com/api', []),
      fetcher: answering(INSTANCE),
      forgetSignIn: forgetNothing,
    })
    expect(choice.snapshot()).toEqual({ status: 'loading', base: null })
    await choice.restore()
    expect(choice.snapshot()).toEqual({ status: 'chosen', base: 'https://cedo.example.com/api' })
    expect(choice.base()).toBe('https://cedo.example.com/api')
  })

  /** A token kept from a build that had no server to name is nobody's to send. */
  test('is none when none is stored, and a sign-in kept without it is forgotten', async () => {
    const log: string[] = []
    const choice = aChoice(aStore(null, log), log)
    await choice.restore()
    expect(choice.snapshot()).toEqual({ status: 'none', base: null })
    expect(log).toEqual(['sign-in forgotten'])
  })

  test('is none when the keychain cannot be read, rather than a spinner for good', async () => {
    const store = aStore(null, [])
    const choice = createServerChoice({
      store: {
        ...store,
        read: async () => {
          throw new Error('keychain locked')
        },
      },
      fetcher: answering(INSTANCE),
      forgetSignIn: forgetNothing,
    })
    const errors = spyOn(console, 'error').mockImplementation(() => null)
    try {
      await choice.restore()
    } finally {
      errors.mockRestore()
    }
    expect(choice.snapshot()).toEqual({ status: 'none', base: null })
  })

  /** The web app is served by its server, and keeps none: nothing to ask for, nothing to read. */
  test('on the web, is the page’s own, and nothing is read', async () => {
    const log: string[] = []
    const choice = createServerChoice({
      store: {
        ...aStore(null, log),
        read: async () => {
          log.push('read')
          return null
        },
      },
      fetcher: answering(INSTANCE),
      forgetSignIn: forgetNothing,
      served: true,
    })
    await choice.restore()
    expect(choice.snapshot()).toEqual({ status: 'served', base: null })
    expect(log).toEqual([])
  })
})

describe('connecting to a server', () => {
  /** One server at a time: a token goes only to the server that issued it. */
  test('checked as cedo, forgets the sign-in before the server is kept', async () => {
    const log: string[] = []
    const store = aStore('https://old.example.com/api', log)
    const choice = aChoice(store, log)
    await choice.restore()
    const heard: string[] = []
    choice.subscribe(() => {
      heard.push(choice.snapshot().base ?? 'none')
    })
    expect(await choice.connect('new.example.com')).toEqual({ kind: 'kept' })
    expect(log).toEqual(['sign-in forgotten', 'server https://new.example.com/api'])
    expect(store.held()).toBe('https://new.example.com/api')
    expect(heard).toEqual(['https://new.example.com/api'])
  })

  test('keeps the address the check landed on', async () => {
    const log: string[] = []
    const store = aStore(null, log)
    const choice = aChoice(store, log, answering(INSTANCE, 200, 'https://nas.local/api/instance'))
    expect(await choice.connect('nas.local')).toEqual({ kind: 'kept' })
    expect(store.held()).toBe('https://nas.local/api')
  })

  /** Checked before kept: nothing changes for an address that is wrong, or a server that is not cedo. */
  test('keeps nothing, and forgets nothing, when the address or the server will not do', async () => {
    const log: string[] = []
    const store = aStore('https://old.example.com/api', log)
    const fetcher = answering('<html>Not found</html>', 404)
    const choice = aChoice(store, log, fetcher)
    await choice.restore()
    expect(await choice.connect('http://cedo.example.com')).toEqual({
      kind: 'problem',
      problem: 'insecure',
    })
    expect(fetcher.asked).toEqual([])
    expect(await choice.connect('media.example.com')).toEqual({ kind: 'not-cedo' })
    expect(log).toEqual([])
    expect(store.held()).toBe('https://old.example.com/api')
  })
})

describe('starting up', () => {
  /** A token kept without its server is forgotten before the session would restore it. */
  test('knows the server before the session is restored', async () => {
    const log: string[] = []
    const choice = aChoice(aStore(null, log), log)
    await startUp(choice, async () => {
      log.push(`session restored, server ${choice.snapshot().status}`)
    })
    expect(log).toEqual(['sign-in forgotten', 'session restored, server none'])
  })
})
