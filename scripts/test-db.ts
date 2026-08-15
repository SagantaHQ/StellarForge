import { db } from '../src/lib/db'

async function main() {
  // List tables
  const tables = await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name` as { table_name: string }[]
  console.log("Tables in database:")
  tables.forEach(t => console.log("  -", t.table_name))
  
  // Create a test user with walletAddress
  const user = await db.user.create({
    data: { 
      email: "test@stellarforge.app", 
      walletAddress: "GTEST1234567890"
    }
  })
  console.log("Created user:", user.id, user.email, user.walletAddress)
  
  // Create a profile
  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: "test-dev",
      displayName: "Test Dev",
    }
  })
  console.log("Created profile:", profile.id, profile.username)
  
  // Query it back
  const found = await db.profile.findUnique({
    where: { username: "test-dev" },
    include: { user: true }
  })
  console.log("Found profile:", found?.username, "for user:", found?.user?.walletAddress)
  
  // Clean up
  await db.profile.delete({ where: { id: profile.id } })
  await db.user.delete({ where: { id: user.id } })
  console.log("✓ Cleanup done — DB is fully functional!")
}

main().catch(console.error).finally(() => db.$disconnect())
