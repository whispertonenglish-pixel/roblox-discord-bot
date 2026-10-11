require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');

// --- ADATBÁZIS (PostgreSQL a Railway-en) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Tábla létrehozása (UserId és a Rangok listája)
pool.query(`
    CREATE TABLE IF NOT EXISTS saved_roles (
        user_id TEXT PRIMARY KEY,
        role_ids TEXT[]
    )
`);

// --- KONFIGURÁCIÓ ---
const LOG_CHANNEL_ID = "1558482103622967476";
const PROTECTED_ROLES = [
    "1528419594639904921",
    "1540106841831251978",
    "1398739258084298794",
    "1398739305773404231",
    "1398739314875043971"
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers // Ez látja a belépő/kilépő embereket
    ]
});

client.on('ready', () => {
    console.log(`✅ A bot elindult: ${client.user.tag}`);
});

// 1. Amikor valaki KILÉP: Elmentjük a rangjait
client.on('guildMemberRemove', async (member) => {
    // Megnézzük, van-e rajta a kért rangok közül bármelyik
    const rolesToSave = member.roles.cache
        .filter(role => PROTECTED_ROLES.includes(role.id))
        .map(role => role.id);

    if (rolesToSave.length > 0) {
        try {
            await pool.query(
                'INSERT INTO saved_roles (user_id, role_ids) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET role_ids = $2',
                [member.id, rolesToSave]
            );
            console.log(`[MENTÉS] ${member.user.tag} kilépett, mentett rangok: ${rolesToSave.join(', ')}`);
        } catch (err) {
            console.error("Hiba az adatbázis mentésnél:", err);
        }
    }
});

// 2. Amikor valaki BELÉP: Visszaadjuk a mentett rangjait
client.on('guildMemberAdd', async (member) => {
    try {
        const res = await pool.query('SELECT role_ids FROM saved_roles WHERE user_id = $1', [member.id]);
        
        if (res.rows.length > 0) {
            const rolesToAdd = res.rows[0].role_ids;
            
            // Rangok visszaadása
            await member.roles.add(rolesToAdd);
            console.log(`[VISSZAADÁS] ${member.user.tag} visszakapta a rangjait.`);
            
            // Üzenet a log csatornába
            const channel = await client.channels.fetch(LOG_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('Rang visszaállítva')
                    .setDescription(`**${member.user.tag}** visszatért, és automatikusan visszakapta a rangjait.`)
                    .addFields({ name: 'Visszaadott rangok száma', value: `${rolesToAdd.length} db` })
                    .setColor(0x2ECC71);
                await channel.send({ embeds: [embed] });
            }
        }
    } catch (err) {
        console.error(`Hiba a rangok kiosztásakor (${member.user.tag}):`, err);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
