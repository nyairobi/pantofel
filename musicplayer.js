const Discord = require ( 'discord.js' );
const logger = require ( './logger.js' );
const Config = require ( './config.json' );
const MusicBot = require ( './musicbot.js' );
const Metadata = require ( 'node-id3' );
const MP3Duration = require( 'mp3-duration' );
const fs = require ( 'fs' );
const genres = require( './genres.json' );

let isVoiceChannel = false;
let dispatcher = undefined;
let voteSkips = 0;
let voteSkipped = { };
let globalVoiceChannel = null;

let totalSongs = 0;
let songMetadata = null;

let currentSong = null;
let songs = [];
let songQueue = [];

let repeat = false;
let voteRepeats = 0;
let votedRepeat = { };

let forcePlay = false;
let forcePlayPath = null;

function shuffleArray ( array )
{
	let newArray = Array.from ( array );
	let remaining = newArray.length, index, temp;

	while ( remaining > 0 )
	{
		index = Math.floor ( ( Math.random ( ) * remaining ) );
		remaining = remaining - 1;

		temp = newArray [remaining];
		newArray [remaining] = newArray [index];
		newArray [index] = temp;
	}

	return newArray;
}

function musicQueueRandomize ( )
{
	logger.log ( '[Info/automusic] a new song queue will now be randomized!' );
	songQueue = shuffleArray ( songs );
}

function musicQueueInsert ( song )
{
	logger.log ( '[Info/automusic] added song to queue: ' + song );
	totalSongs ++;
	songQueue.push ( song );
}

function musicQueuePop ( )
{
	return songQueue.pop ( );
}

function getNextSong ( )
{
	if ( songQueue.length > 0 )
	{
		return musicQueuePop ( );
	}
	else
	{
		generateSongList ( );
		musicQueueRandomize ( );

		return musicQueuePop ( );
	}
}

function generateSongList ( )
{
	songs = [ ];

	fs.readdirSync ( './playlist' ).forEach ( function ( file )
	{
		songs.push ( file );
	} );

	totalSongs = songs.length;
}

function getRandomAnnouncer ( )
{
	let announcerMessages = [ ];

	fs.readdirSync ( './announcer' ).forEach ( function ( file )
	{
		announcerMessages.push ( file );
	} );

	let rng = Math.floor ( Math.random ( ) * announcerMessages.length );
	return announcerMessages [rng];
}

function musicQueueGet ( )
{
	return Array.from ( songQueue );
}

function getCurrentDispatcher ( )
{
	return dispatcher;
}

function getCurrentSong ( )
{
	return currentSong;
}

function getSongList ( )
{
	generateSongList ( );
	return songs;
}

function playAnnouncer ( Client )
{
	let song = repeat ? currentSong : forcePlay ? forcePlayPath : getNextSong ( );

	forcePlay = false;
	repeat = false;
	voteRepeats = 0;
	votedRepeat = { };
	voteSkips = 0;
	voteSkipped = { };

	let announcerFile = getRandomAnnouncer ( );
	logger.log ( `[Info/automusic] will now play ${song} after announcer ${announcerFile}.`);

	let announcer = globalConnection.play (`./announcer/${announcerFile}`, { passes: 3 } );

	announcer.on ( 'error', function ( m ) { logger.error ( m ); } );

	announcer.on ( 'end', ( ) =>
	{
		setTimeout ( function ( )
		{
			playSong ( Client, song );
		}, 500 );
	} );
}

function playSong ( Client, song )
{
	currentSong = song;

	dispatcher = globalConnection.play ( `./playlist/${song}`, { passes: 3 } );

	dispatcher.on ( 'error', function ( m ) { logger.error ( m ); } );

	Metadata.read ( `./playlist/${song}`, function ( err, tags ) {
		if ( err )
			logger.error ( err );
		songMetadata = tags;
		MP3Duration( `./playlist/${song}`, function ( err, duration ) {
		  	if ( err )
		  		logger.log(err.message);
		  	songMetadata.duration = duration;
		});
	} );

	dispatcher.on ( 'end', ( ) =>
	{
		dispatcher = null;
		Client.user.setActivity ( `weeb shit`, { type: 'LISTENING' } );
		setTimeout ( function ( )
		{
			if( globalVoiceChannel.members.size > 1 )
			{
				playAnnouncer( Client );
			}
		}, 1000 );
	} );

}

function join ( Client )
{
	globalVoiceChannel.join ( ).then ( function ( connection )
	{
		connection.on ( 'disconnect', function ( )
		{
			logger.log ( '[Info/automusic] disconnected from channel, will reconnect soon' );

			setTimeout ( function ( )
			{
				logger.log ( '[Info/automusic] reconnecting' );
				join ( Client );
			}, 3000 );
		} );

		globalConnection = connection;

		playAnnouncer( Client );
	} ).catch (function ( error ) {
		logger.log ( '[Error/automusic] cannot join voice channel' );
		logger.log ( error );
	} );
}

function init ( Client ) {
	generateSongList ( );
	musicQueueRandomize ( );

    ///////////////////////
    // bruh moment
    ///////////////////////
	globalVoiceChannel = Client.channels.cache.get ( Config.channel_id );

	if( ! globalVoiceChannel ) {
		logger.log ( `[Info/automusic] WARNING! ${Config.channel_id} is not a valid channel id!` );
	}
	else if (! ( globalVoiceChannel instanceof Discord.VoiceChannel ) )
	{
		logger.log ( `[Info/automusic] WARNING! ${Config.channel_id} is not a valid voice channel id!` );
	}
	else
	{
		join ( Client );
	}
}

function voteSkipHandler ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}

    if ( !message.member.voice.channel ) return;
    if ( message.member.voice.channel.id != globalVoiceChannel.id ) return;

    let userid = message.author.id;
	let onlineusers = globalVoiceChannel.members.size;
	let required = Math.floor ( ( onlineusers - 1 ) / 2 );

	if ( !voteSkipped [userid] )
	{
        if ( voteSkips > required ) return;

		voteSkips++;
		message.channel.send ( `Zarejestrowano twój głos **${voteSkips}/${( required + 1 )}**` );

		voteSkipped [userid] = true;

		if ( voteSkips > required )
		{
			message.channel.send ( "Głosem większości dostępnych piosenka została pominięta." );
			dispatcher.end ( );
		}
	}
    else
    {
        message.channel.send ( "Twój głos był już zarejestrowany." );
    }
}

MusicBot.registerCommand ( 'voteskip', voteSkipHandler );
MusicBot.registerCommand ( 'vs', voteSkipHandler );

MusicBot.registerCommand ( 'cancelvote', function ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}
    let userid = message.author.id;
    let onlineusers = globalVoiceChannel.members.size;
    let required = Math.floor ( ( onlineusers - 1 ) / 2 );

    if ( voteSkipped [userid] )
    {
        voteSkips--;
        message.channel.send ( "Wycofano twój głos **" + voteSkips + "/" + ( required + 1 ) + "**" );
        voteSkipped [userid] = false;
    }
    else
    {
        message.channel.send ( "Nie głosowałeś za pominięciem tej piosenki." );
    }
} );

MusicBot.registerCommand ( 'lock', function ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}
    message.channel.send ( "Nie będę wyłączał tej chujowej piosenki z demokratycznego głosowania." );
} );

MusicBot.registerCommand ( 'skip', function ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}
    if ( message.member.hasPermission ( 'KICK_MEMBERS' ) )
    {
        message.channel.send ( `Użytkownik **${message.author.username}** pominął piosenkę!` );
		dispatcher.end ( );
    }
} );

function songStatus ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}
	function fmt(s){return(s-(s%=60))/60+(9<s?':':':0')+s}
	let s = new Date() - dispatcher.startTime;

	fs.writeFile("./cover.png", songMetadata.image ? songMetadata.image.imageBuffer : null, 'base64', function ( err ) {
	  	if ( err )
			logger.error(err);
		let embed = {
			author: {
				name: songMetadata.artist
			},
			image: 'https://localhost:3000/cover',
			color: genres[parseInt(songMetadata.genre.substr(1))].color,
			title: songMetadata.title,
			description: `${fmt(~~(s/1000))}/${fmt(~~songMetadata.duration)}`,
			fields: [
				{
					name: "album",
					value: songMetadata.album
				},
				{
					name: "genre",
					value: genres[parseInt(songMetadata.genre.substr(1))].name
				},
				{
					name: "linki",
					value: `[Pobierz](${Config.server_url}songpreview?title=${currentSong.replace(/ /g, '%20')})  [Edytuj](${Config.server_url}song?title=${currentSong.replace(/ /g, '%20')})`
				}
			]
		};
		message.channel.send({embed: embed});
	});
}

MusicBot.registerCommand ( 'songname', songStatus )

MusicBot.registerCommand ( 'status', songStatus )

MusicBot.registerCommand ( 'queue', function ( message, args )
{
    message.channel.send ( `W kolejce pozostało **${songQueue.length}/${totalSongs}** piosenek` );
} );

MusicBot.registerCommand ( 'voterepeat', function ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}
    if ( repeat ) return;
    if ( !message.member.voice.channel ) return;
    if ( message.member.voice.channel.id != globalVoiceChannel.id ) return;

    let userid = message.author.id;
    let onlineusers = globalVoiceChannel.members.size;
    let required = Math.floor ( ( onlineusers - 1 ) / 2 );

    if ( !votedRepeat [userid] )
    {
        if ( voteRepeats > required );

        voteRepeats++;
        message.channel.send ( "Zarejestrowano twój glos **" + voteRepeats + "/" + ( required + 1 ) + "**" );

        votedRepeat [userid] = true;

        if ( voteRepeats > required )
        {
            message.channel.send ( "Głosem większości dostępnych piosenka zostanie powtórzona." );
            repeat = true;
        }
    }
    else
    {
        message.channel.send ( "Twój głos był już zarejestrowany." );
    }
} );

MusicBot.registerCommand ( 'repeat', function ( message, args )
{
	if ( ! dispatcher)
	{
		message.channel.send ( `Aktualnie nie jest grana żadna piosenka.`);
		return;
	}
    if ( message.member.hasPermission ( 'KICK_MEMBERS' ) && !repeat )
    {
        message.channel.send ( "Użytkownik **" + message.author.username + '** zarządził powtórzenie aktualnej piosenki po jej zakończeniu!' );
		repeat = true;
    }
} );

MusicBot.registerCommand ( 'forceplay', function ( message, args )
{
	if ( Config.owners.indexOf ( message.author.id ) === -1 ) return;

	if ( args.length < 2 )
	{
		message.channel.send ( "Wymagany jeden argument: plik do odtworzenia (tekst)" );
		return;
	}

	forcePlay = true;
	forcePlayPath = args [1];
	dispatcher.end ( );

	message.channel.send ( "Wymuszone zostanie odtwarzanie pliku: **" + forcePlayPath + "**" );
} );

module.exports.init = init;
module.exports.playMusic = playAnnouncer;
module.exports.musicQueueInsert = musicQueueInsert;
module.exports.musicQueuePop = musicQueuePop;
module.exports.musicQueueRandomize = musicQueueRandomize;
module.exports.musicQueueGet = musicQueueGet;
module.exports.getCurrentDispatcher = getCurrentDispatcher;
module.exports.getCurrentSong = getCurrentSong;
module.exports.getSongList = getSongList;
