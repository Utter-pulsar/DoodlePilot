import { newId, nowISO, DEFAULT_SETTINGS } from '@shared/types'
import type { ChecklistItem, Collection, FieldDef, RecordItem, SelectOption } from '@shared/types'
import type { Database } from './store'

// Default content shown on first launch. It demonstrates the core ideas:
//   - several customizable lanes (People / Projects / Weekly / Daily)
//   - two-way links (a project lists members; a person lists their projects)
//   - daily tasks: one card = a day, holding a checklist of tasks each with a status
//   - archiving a card moves it to a "<lane>-历史" lane (auto-created)
// Everything here is fully editable by the user afterwards.

// The current schema version. seedDatabase() stamps it on brand-new installs; store.ts walks an
// OLDER DB up to it via in-place `migrations` (it never wipes). When you change the data
// structure, bump this AND add the matching migration step in store.ts.
export const SEED_VERSION = 2

function status(label: string, color: string): SelectOption {
  return { id: newId('opt'), label, color }
}

export function seedDatabase(): Database {
  const ts = { createdAt: nowISO(), updatedAt: nowISO() }

  // --- collection ids (declared up front so fields can cross-reference) ---
  const peopleId = newId('col')
  const projectsId = newId('col')
  const weeklyId = newId('col')
  const dailyId = newId('col')

  // --- shared status options (reused by status fields + the daily checklist) ---
  const todo = status('待办', 'marker-coral')
  const doing = status('进行中', 'marker-yellow')
  const done = status('已完成', 'marker-green')
  const mkStatusField = (name = '状态'): FieldDef => ({
    id: newId('fld'),
    name,
    type: 'status',
    config: { options: [todo, doing, done], doneOptionIds: [done.id] }
  })

  // --- People ---
  const personName: FieldDef = { id: newId('fld'), name: '姓名', type: 'text', primary: true }
  const personRole: FieldDef = { id: newId('fld'), name: '岗位', type: 'text' }
  const personProjects: FieldDef = {
    id: newId('fld'),
    name: '负责项目',
    type: 'relation',
    config: { targetCollectionId: projectsId },
    showOnCard: true // show the linked project right on the person card
  }
  const people: Collection = {
    id: peopleId,
    name: '人员',
    icon: '🧑‍🚀',
    kind: 'people',
    order: 0,
    fields: [personName, personRole, personProjects],
    ...ts
  }

  // --- Projects ---
  const projName: FieldDef = { id: newId('fld'), name: '项目名称', type: 'text', primary: true }
  const projStatus = mkStatusField()
  const projMembers: FieldDef = {
    id: newId('fld'),
    name: '成员',
    type: 'person',
    config: { targetCollectionId: peopleId, reverseFieldId: personProjects.id }
  }
  const projGoal: FieldDef = { id: newId('fld'), name: '项目目标', type: 'longText' }
  const projPeriod: FieldDef = { id: newId('fld'), name: '周期', type: 'dateRange' }
  // close the two-way link the other direction
  personProjects.config = { targetCollectionId: projectsId, reverseFieldId: projMembers.id }
  const projects: Collection = {
    id: projectsId,
    name: '项目',
    icon: '🗂️',
    kind: 'projects',
    order: 1,
    fields: [projName, projStatus, projMembers, projGoal, projPeriod],
    ...ts
  }

  // --- Weekly tasks ---
  const weekTitle: FieldDef = { id: newId('fld'), name: '本周任务', type: 'text', primary: true }
  const weekStatus = mkStatusField()
  const weekProject: FieldDef = {
    id: newId('fld'),
    name: '所属项目',
    type: 'relation',
    config: { targetCollectionId: projectsId }
  }
  const weekly: Collection = {
    id: weeklyId,
    name: '每周任务',
    icon: '📅',
    kind: 'weeklyTasks',
    order: 2,
    fields: [weekTitle, weekStatus, weekProject],
    ...ts
  }

  // --- Daily tasks: one card = a day; a checklist of tasks, each with its own status ---
  const dayDate: FieldDef = { id: newId('fld'), name: '日期', type: 'text', primary: true }
  const dayTasks: FieldDef = {
    id: newId('fld'),
    name: '任务',
    type: 'checklist',
    config: { options: [todo, doing, done], doneOptionIds: [done.id] },
    showOnCard: true // the day's tasks are the card's content
  }
  const daily: Collection = {
    id: dailyId,
    name: '每日任务',
    icon: '🗓️',
    kind: 'dailyTasks',
    order: 3,
    fields: [dayDate, dayTasks],
    ...ts
  }

  // --- demo records ---
  const aliceId = newId('rec')
  const bobId = newId('rec')
  const projAId = newId('rec')
  const todayTasks: ChecklistItem[] = [
    { id: newId('ck'), text: '搭好项目骨架', status: done.id },
    { id: newId('ck'), text: '画第一套手绘帧', status: doing.id },
    { id: newId('ck'), text: '接入闹钟横幅', status: todo.id }
  ]

  const records: RecordItem[] = [
    {
      id: aliceId,
      collectionId: peopleId,
      order: 0,
      archived: false,
      fields: { [personName.id]: '小艾', [personRole.id]: '设计', [personProjects.id]: [projAId] },
      ...ts
    },
    {
      id: bobId,
      collectionId: peopleId,
      order: 1,
      archived: false,
      fields: { [personName.id]: '阿波', [personRole.id]: '前端', [personProjects.id]: [projAId] },
      ...ts
    },
    {
      id: projAId,
      collectionId: projectsId,
      order: 0,
      archived: false,
      fields: {
        [projName.id]: 'DoodlePilot',
        [projStatus.id]: doing.id,
        [projMembers.id]: [aliceId, bobId],
        [projGoal.id]: '做一个手绘风的桌面伙伴',
        [projPeriod.id]: { start: nowISO(), end: null }
      },
      ...ts
    },
    {
      id: newId('rec'),
      collectionId: dailyId,
      order: 0,
      archived: false,
      fields: { [dayDate.id]: `${nowISO().slice(0, 10)} 全天任务`, [dayTasks.id]: todayTasks },
      ...ts
    }
  ]

  return {
    version: SEED_VERSION,
    collections: [people, projects, weekly, daily],
    records,
    alarms: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}
