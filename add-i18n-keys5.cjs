const fs = require('fs')
const path = require('path')

const KEYS = {
  ko: { 'match.safeCall': '안심번호 통화' },
  en: { 'match.safeCall': 'Safe-number call' },
  ja: { 'match.safeCall': '安心番号通話' },
  zh: { 'match.safeCall': '安全号码通话' },
}

for (const locale of Object.keys(KEYS)) {
  const file = path.join(__dirname, 'messages', `${locale}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  let added = 0
  for (const [key, value] of Object.entries(KEYS[locale])) {
    if (!(key in data)) {
      data[key] = value
      added += 1
    }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(locale, 'added', added)
}
