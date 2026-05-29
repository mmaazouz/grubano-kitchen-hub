// prisma/seed-test-user.js
// Creates (or updates) a demo consumer account for testing the /eat consumer app.
//
// Usage (locally or on the o2switch server via SSH, from the app root):
//   node prisma/seed-test-user.js
//
// On the server, make sure the Prisma client is generated first:
//   ./node_modules/.bin/prisma generate   (uses pinned 5.22.0)
//
// Credentials created:
//   email:    test@grubano.com
//   password: Test1234!   (bcrypt, cost 12)
//   role:     consumer

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

const EMAIL = 'test@grubano.com'
const PASSWORD = 'Test1234!'

async function main() {
  const hashed = await bcrypt.hash(PASSWORD, 12)

  const user = await prisma.operator.upsert({
    where: { email: EMAIL },
    update: { password: hashed, role: 'consumer', status: 'active', name: 'Compte Démo' },
    create: {
      name: 'Compte Démo',
      email: EMAIL,
      password: hashed,
      role: 'consumer',
      status: 'active',
    },
  })

  console.log('✅ Test user ready:')
  console.log('   id:    ', user.id)
  console.log('   email: ', user.email)
  console.log('   role:  ', user.role)
  console.log('   password: Test1234!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
