require('dotenv').config();
const { Client, Intents, EmbedBuilder, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const admin = require('firebase-admin');
const cron = require('node-cron');
const serviceAccount = require('./railroad-manager-4e2d4-firebase-adminsdk-861tn-9e70d69611.json');
const { config } = require('dotenv');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const bannedUsersCollection = db.collection('bannedUsers');
const moderatorLogsCollection = db.collection('moderatorLogs');

const client = new Client({
    intents: [
        1 << 0, 
        1 << 9, 
        1 << 10, 
        1 << 12 
    ]
});

const allowedUserIds = ['772873481641525278', '668231700983185429', '709211428468555776', '249912636135702529', '714595820850118797'];

client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setStatus('online');
    client.user.setActivity('Watching for the idiots that get banned!');

    const commands = [
        new SlashCommandBuilder()
            .setName('add')
            .setDescription('Ban a user and add to the ban list')
            .addStringOption(option => option.setName('userid').setDescription('The ID of the user to ban').setRequired(true)),
        new SlashCommandBuilder()
            .setName('remove')
            .setDescription('Unban a user and remove from the ban list')
            .addStringOption(option => option.setName('userid').setDescription('The ID of the user to unban').setRequired(true)),
        new SlashCommandBuilder()
            .setName('sync')
            .setDescription('Ban all users in the ban list in the current server'),
        new SlashCommandBuilder()
            .setName('mastersync')
            .setDescription('Ban all users in the ban list in all servers'),
        new SlashCommandBuilder()
            .setName('info')
            .setDescription('Railroad Manager info'),
        new SlashCommandBuilder()
            .setName('run')
            .setDescription('Set up a reaction role system.')
            .addStringOption(option => option.setName('message').setDescription('The message to react to').setRequired(true))
            .addStringOption(option => option.setName('emoji').setDescription('Emoji to use for the reaction').setRequired(true))
            .addRoleOption(option => option.setName('role').setDescription('Role to assign').setRequired(true))
    ];

    commands.forEach(command => {
        client.application.commands.create(command);
    });

   
   
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, guild } = interaction;
    const guildName = guild?.name ?? 'Unknown Guild'; // Added safeguard for guildName in case of null
    const userId = interaction.options.getString('userid');

    try {
        if (!allowedUserIds.includes(user.id)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        if (commandName === 'add') {
            const userToBan = await client.users.fetch(userId);

            if (!userToBan) {
                await interaction.reply({ content: `User with ID ${userId} not found.`, ephemeral: true });
                return;
            }

            await Promise.all(client.guilds.cache.map(async (guild) => {
                try {
                    await guild.members.ban(userId, { reason: 'Banned by bot command' });
                } catch (error) {
                    console.error(`Failed to ban in guild ${guild.id}:`, error);
                }
            }));

            await bannedUsersCollection.doc(userId).set({ userId });

            const banEmbed = new EmbedBuilder()
                .setTitle('User Banned')
                .setDescription(`User: ${userToBan.tag} has been banned in all servers and added to the ban list.`)
                .setColor('Red');

            await moderatorLogsCollection.add({
                action: 'ban',
                userId,
                userTag: userToBan.tag,
                moderatorId: user.id,
                moderatorTag: user.tag,
                guildName,
                timestamp: new Date(),
            });

            await interaction.reply({ embeds: [banEmbed] });
        }

        if (commandName === 'remove') {
            const userToUnban = await client.users.fetch(userId);

            if (!userToUnban) {
                await interaction.reply({ content: `User with ID ${userId} not found.`, ephemeral: true });
                return;
            }

            await Promise.all(client.guilds.cache.map(async (guild) => {
                try {
                    await guild.members.unban(userId, 'Unbanned by bot command');
                } catch (error) {
                    console.error(`Failed to unban in guild ${guild.id}:`, error);
                }
            }));

            await bannedUsersCollection.doc(userId).delete();

            const unbanEmbed = new EmbedBuilder()
                .setTitle('User Unbanned')
                .setDescription(`User: ${userToUnban.tag} has been unbanned in all servers and removed from the ban list.`)
                .setColor('Green');

            await moderatorLogsCollection.add({
                action: 'unban',
                userId,
                userTag: userToUnban.tag,
                moderatorId: user.id,
                moderatorTag: user.tag,
                guildName,
                timestamp: new Date(),
            });

            await interaction.reply({ embeds: [unbanEmbed] });
        }

        if (commandName === 'sync') {
            const snapshot = await bannedUsersCollection.get();
            snapshot.forEach(async (doc) => {
                const userId = doc.data().userId;
                try {
                    await interaction.guild.members.ban(userId, { reason: 'Banned by sync command' });
                } catch (error) {
                    console.error(`Failed to ban in guild ${interaction.guild.id}:`, error);
                }
            });

            await moderatorLogsCollection.add({
                action: 'sync',
                moderatorId: user.id,
                moderatorTag: user.tag,
                guildName,
                timestamp: new Date(),
            });

            const syncEmbed = new EmbedBuilder()
                .setTitle('Server Synced to Railroad Manager Database')
                .setDescription(`${user.tag} has synced the list, everyone on the list is now banned.`)
                .setColor('Red');

            await interaction.reply({ embeds: [syncEmbed] });
        }

        if (commandName === 'mastersync') {
            const snapshot = await bannedUsersCollection.get();
            snapshot.forEach(async (doc) => {
                const userId = doc.data().userId;
                await Promise.all(client.guilds.cache.map(async (guild) => {
                    try {
                        await guild.members.ban(userId, { reason: 'Banned by mastersync command' });
                    } catch (error) {
                        console.error(`Failed to ban in guild ${guild.id}:`, error);
                    }
                }));
            });

            await moderatorLogsCollection.add({
                action: 'mastersync',
                moderatorId: user.id,
                moderatorTag: user.tag,
                timestamp: new Date(),
            });

            const masterSyncEmbed = new EmbedBuilder()
                .setTitle(`Master Sync done by ${user.tag}`)
                .setDescription(`${user.tag} has synced the list across all servers, everyone on the list is now banned.`)
                .setColor('Red')
                .setTimestamp();

            await interaction.reply({ embeds: [masterSyncEmbed] });
        }

        if (commandName === 'info') {
            const infoEmbed = new EmbedBuilder()
                .setTitle('Railroad Manager Info')
                .setDescription('Railroad Manager is a bot created to manage user bans across multiple servers. It allows you to ban or unban users, sync ban lists, and more.')
                .setColor('Blue');

            await interaction.reply({ embeds: [infoEmbed], ephemeral: true });
        }

        if (commandName === 'run') {
            // Check if the user has "Manage Roles" permission or is in the allowedUserIds list
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles) && !allowedUserIds.includes(user.id)) {
                await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                return;
            }

            const messageId = interaction.options.getString('message');
            const emoji = interaction.options.getString('emoji');
            const role = interaction.options.getRole('role');

            try {
                const channel = interaction.channel; // Assuming the message is in the same channel
                const message = await channel.messages.fetch(messageId);

                await message.react(emoji);

                const filter = (reaction, user) => reaction.emoji.name === emoji && !user.bot;

                const collector = message.createReactionCollector({ filter });

                collector.on('collect', async (reaction, user) => {
                    const member = await interaction.guild.members.fetch(user.id);
                    await member.roles.add(role);
                });

                await interaction.reply({ content: `Reaction role system set up successfully for message ${messageId}.`, ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: 'An error occurred while setting up the reaction role system.', ephemeral: true });
                console.error(error);
            }
        }
    } catch (error) {
        await interaction.reply({ content: 'An error occurred while processing your command.', ephemeral: true });
        console.error(error);
    }
});

client.login(config.abc);
