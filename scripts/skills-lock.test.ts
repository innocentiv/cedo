import { describe, expect, test } from 'bun:test'
import { SKILLS_CLI, installsFromLock, skillsAddCommand } from './skills-lock.ts'

const SHA = '4ae2317ddb22b046e26455e4f9c9b3aaaf62212d'
const OTHER = '0000000000000000000000000000000000000abc'

function skill(source: string, ref?: string) {
  return {
    source,
    sourceType: 'github',
    skillPath: 'skills/x/SKILL.md',
    computedHash: 'f'.repeat(64),
    ...(ref === undefined ? {} : { ref }),
  }
}

describe('installsFromLock', () => {
  test('one source at one commit is one install, its skills in name order', () => {
    const lock = {
      version: 1,
      skills: {
        tdd: skill('mattpocock/skills', SHA),
        'code-review': skill('mattpocock/skills', SHA),
      },
    }
    expect(installsFromLock(lock)).toEqual([
      { from: `mattpocock/skills#${SHA}`, names: ['code-review', 'tdd'] },
    ])
  })

  test('the same source at two commits is two installs', () => {
    const lock = {
      version: 1,
      skills: { tdd: skill('mattpocock/skills', SHA), pr: skill('mattpocock/skills', OTHER) },
    }
    expect(installsFromLock(lock).map((i) => i.from)).toEqual([
      `mattpocock/skills#${OTHER}`,
      `mattpocock/skills#${SHA}`,
    ])
  })

  test('a skill not pinned to a commit is refused, by name, so no two contributors differ', () => {
    const lock = {
      version: 1,
      skills: { tdd: skill('mattpocock/skills', SHA), pr: skill('mattpocock/skills') },
    }
    expect(() => installsFromLock(lock)).toThrow(/pr.*not pinned/u)
  })

  test('a ref that is a branch or tag, not a full commit, is refused too', () => {
    const lock = { version: 1, skills: { tdd: skill('mattpocock/skills', 'main') } }
    expect(() => installsFromLock(lock)).toThrow(/tdd.*not pinned/u)
  })

  test('a lock version setup does not know is refused rather than half-read', () => {
    expect(() => installsFromLock({ version: 2, skills: {} })).toThrow(/version 2/u)
  })
})

describe('skillsAddCommand', () => {
  test('installs for Claude Code and Codex, without prompts, with the skill names last', () => {
    const command = skillsAddCommand({ from: `mattpocock/skills#${SHA}`, names: ['pr', 'tdd'] })
    expect(command.slice(-3)).toEqual(['-s', 'pr', 'tdd'])
    expect(command).toContain('-y')
    const agents = command.indexOf('-a')
    expect(command.slice(agents + 1, agents + 3)).toEqual(['claude-code', 'codex'])
    expect(command).toContain(`mattpocock/skills#${SHA}`)
  })

  test('runs a pinned version of the skills CLI, on Bun, so no global Node is needed', () => {
    const command = skillsAddCommand({ from: `mattpocock/skills#${SHA}`, names: ['pr'] })
    expect(command.slice(0, 3)).toEqual(['bunx', '--bun', SKILLS_CLI])
    expect(SKILLS_CLI).toMatch(/^skills@\d+\.\d+\.\d+$/u)
  })
})
