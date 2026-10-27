const test = require('node:test')
const assert = require('node:assert/strict')
const { beijingParts, toISO, duration, weekRange, moveDay, monthToday, displayInterval, displayScheduleInterval } = require('../utils/time')

test('schedule cards show a single dotted date and a dash, with a day offset for overnight work',()=>{
  assert.equal(displayScheduleInterval('2026-10-24T11:00:00Z','2026-10-24T15:00:00Z'),'10.24 19:00 - 23:00')
  assert.equal(displayScheduleInterval('2026-10-24T15:00:00Z','2026-10-24T18:00:00Z'),'10.24 23:00 - 次日02:00')
  assert.equal(displayScheduleInterval('2026-12-31T15:00:00Z','2027-01-02T18:00:00Z'),'12.31 23:00 - 02:00（+3天）')
})

test('UTC timestamps display as Beijing time regardless of device timezone', () => {
  assert.deepEqual(beijingParts('2030-01-31T16:15:00Z'), { date: '2030-02-01', time: '00:15' })
  assert.equal(toISO('2030-02-01', '00:15'), '2030-02-01T00:15:00+08:00')
  assert.equal(monthToday(new Date('2030-01-31T16:15:00Z')), '2030-02')
})

test('cross midnight duration validates actual dates instead of guessing next day', () => {
  assert.equal(duration('2030-01-31', '23:30', '2030-02-01', '01:00'), 90)
  assert.throws(() => duration('2030-01-31', '23:30', '2030-01-31', '01:00'), /结束/)
  assert.throws(() => toISO('2030-02-30', '12:00'), /日期/)
  assert.throws(() => toISO('2030-01-01', '24:00'), /时间/)
})

test('Monday week ranges and date movement span years without device offset errors', () => {
  assert.deepEqual(weekRange('2030-01-01'), { start: '2029-12-31', end: '2030-01-07' })
  assert.equal(moveDay('2030-01-01', -1), '2029-12-31')
  assert.equal(displayInterval('2030-01-31T15:30:00Z', '2030-01-31T17:00:00Z'), '01-31 23:30 → 02-01 01:00')
})
