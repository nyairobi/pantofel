const requestlib = require ( 'request' );
const formidable = require ( 'formidable' );
const util = require ( 'util' );
const fs = require ( 'fs' );

const Config = require ( './config.json' );
const WebServer = require ( './index.js' );
const Metadata = require ( 'node-id3' );

const fileutil = require ( './fileutil.js' );
const logger = require ( './logger.js' );

const MusicPlayer = require ( './musicplayer.js' );

const genres = require( './genres.json' );

let verySadDatabase = {};

fs.readdirSync ( './playlist' ).forEach ( function ( file )
{
    Metadata.read ( `./playlist/${file}`, function ( err, tags ) {
        verySadDatabase[file] = {
            artist: tags.artist ? tags.artist : '',
            title: tags.title ? tags.title : '',
            album: tags.album ? tags.album : '',
            genre: tags.raw && tags.raw.TCON ? parseInt(tags.raw.TCON.substr(1)) : 12
        }
    } );
} );

function verifyUserCredentials ( access_token, token_type, success, failure )
{
    requestlib.get ( {
        url: 'https://discordapp.com/api/users/@me',
        headers: { authorization: token_type + ' ' + access_token }
    }, function ( error, res, body )
    {
        if ( !error )
        {
            success ( JSON.parse ( body ) );
        }
        else failure ( error );
    } );
}

function displayApiError ( request, response, code, message )
{
    response.writeHead ( code, { 'Content-Type': 'application/json' } );
    response.write ( JSON.stringify ( { success: false, message: message } ) );
    response.end ( );
}

WebServer.registerRequestHandler ( '/cover.png', function ( request, response, requestData, cookies, session )
{
    response.writeHead ( 200, { 'Content-Type': 'image/png' } );
    response.write ( )
    response.end ( );
} );

WebServer.registerRequestHandler ( '/', function ( request, response, requestData, cookies, session )
{
    response.writeHead ( 200, { 'Content-Type': 'text/html' } );
    if ( session.variables.discordAuth )
    {
        let userdata = session.variables.discordAuth.userdata;

        WebServer.renderTemplate ( 'index-logged', request, response,
        {
            username: userdata.username,
            useravatar: 'https://cdn.discordapp.com/avatars/' + userdata.id + '/' + userdata.avatar + '.png',
            discriminator: userdata.discriminator
        } );
    }
    else
    {
        WebServer.renderTemplate ( 'index', request, response, {} );
    }
    response.end ( );
} );

WebServer.registerRequestHandler ( '/songpreview', function ( request, response, requestData, cookies, session )
{
    if ( requestData.query && requestData.query.title )
    {
        let filename = new String ( requestData.query.title );
        let fullPath = './playlist/' + filename;

        fullPath = fullPath.replace( /\.\.\//g, '' );

        if ( fs.existsSync ( fullPath ) )
        {
		    let stat = fs.statSync ( fullPath );

		    response.writeHead ( 200,
		    {
			    'Content-Type': 'audio/mpeg',
			    'Content-Length': stat.size
		    } );

		    let readStream = fs.createReadStream ( fullPath )
		    readStream.pipe ( response );
        }
        else
        {
            response.writeHead ( 200, { 'Content-Type': 'application/json' } );
            response.write ( JSON.stringify ( { 'error': true, 'message': 'not found' } ) );
            response.end ( );
        }
    }
    else
    {
        WebServer.redirect ( request, response, '/' );
    }
} );

WebServer.registerRequestHandler ( '/songlist', function ( request, response, requestData, cookies, session )
{
    let list = MusicPlayer.getSongList ( );

    response.writeHead ( 200, { 'Content-Type': 'application/json' } );
    response.write ( JSON.stringify ( { songs: list } ) );
    response.end ( );
} );

WebServer.registerRequestHandler ( '/id3', function ( request, response, requestData, cookies, session )
{
    if ( request.method.toLowerCase ( ) == 'post' )
    {
        if ( !session.variables.discordAuth && Config.auth_required )
        {
            displayApiError ( request, response, 403, 'authentication required' );
            return;
        }

        let form = new formidable.IncomingForm ( );

        form.parse ( request, function ( error, fields, files )
        {
            let songname = fields.songname;
            fields.songname = null;
            fields.TCON = `(${fields.TCON})`;
            let success = Metadata.write(fields, `./playlist/${songname}`);

            verySadDatabase [ songname ] = {
                artist: fields.artist,
                title: fields.title,
                album: fields.album,
                genre: fields.TCON
            }

            if ( success )
            {
                response.writeHead ( 200, { 'Content-Type': 'application/json' } );
                response.write ( JSON.stringify ( { success: true, message: 'upload complete' } ) );
                response.end ( );
            }
            else
            {
                response.writeHead ( 400, { 'Content-Type': 'application/json' } );
                response.write ( JSON.stringify ( { success: false, message: 'invalid file' } ) );
                response.end ( );
            }
            if ( error ) return displayApiError ( request, response, 400, 'invalid request' );
        } );
    }
    else displayApiError ( request, response, 405, 'method not allowed' );
} );

WebServer.registerRequestHandler ( '/process', function ( request, response, requestData, cookies, session )
{
    if ( request.method.toLowerCase ( ) == 'post' )
    {
        if ( !session.variables.discordAuth && Config.auth_required )
        {
            displayApiError ( request, response, 403, 'authentication required' );
            return;
        }

        let form = new formidable.IncomingForm ( );
        form.uploadDir = './uploads';
        form.maxFileSize = 10 * 1024 * 1024;

        form.parse ( request, function ( error, fields, files )
        {
            if ( error ) return displayApiError ( request, response, 400, 'invalid request' );

            if ( !files.song )
            {
                response.writeHead ( 400, { 'Content-Type': 'application/json' } );
                response.write ( JSON.stringify ( { success: false, message: 'no files uploaded' } ) );
                response.end ( );

                return;
            }

            let path = files.song.path;
            fileutil.handleUploadedFile ( path, function ( songname )
            {
                MusicPlayer.musicQueueInsert ( songname + '.mp3' );

                Metadata.read ( `./playlist/${songname}.mp3`, function ( err, tags ) {
                    verySadDatabase[`${songname}.mp3`] = {
                        artist: tags.artist ? tags.artist : '',
                        title: tags.title ? tags.title : '',
                        album: tags.album ? tags.album : '',
                        genre: tags.raw && tags.raw.TCON ? parseInt(tags.raw.TCON.substr(1)) : 12
                    }
                } );

                // success
                response.writeHead ( 200, { 'Content-Type': 'application/json' } );
                response.write ( JSON.stringify ( { success: true, message: 'upload complete' } ) );
                response.end ( );
            }, function ( )
            {
                return displayApiError ( request, response, 400, 'invalid file format' );
            } );
        } );
    }
    else displayApiError ( request, response, 405, 'method not allowed' );
} );

WebServer.registerRequestHandler ( '/upload', function ( request, response, requestData, cookies, session )
{
    if ( session.variables.discordAuth )
    {
        response.writeHead ( 200, { 'Content-Type': 'text/html' } );
        let userdata = session.variables.discordAuth.userdata;

        WebServer.renderTemplate ( 'uploadform', request, response,
        {
            username: userdata.username,
            useravatar: 'https://cdn.discordapp.com/avatars/' + userdata.id + '/' + userdata.avatar + '.png',
            discriminator: userdata.discriminator
        } );

        response.end ( );
    }
    else
    {
        return WebServer.redirect ( request, response, '/' );
    }
} );

WebServer.registerRequestHandler ( '/song', function ( request, response, requestData, cookies, session )
{
    if ( session.variables.discordAuth && requestData.query && requestData.query.title )
    {
        let filename = new String ( requestData.query.title );
        let fullPath = `./playlist/${filename}`;

        fullPath = fullPath.replace( /\.\.\//g, '' );

        if ( fs.existsSync ( fullPath ) )
        {
		    let stat = fs.statSync ( fullPath );

            response.writeHead ( 200, { 'Content-Type': 'text/html' } );
            // let userdata = {username: 'aler', discriminator: 'rzer', avatar: 'nie'};
            let userdata = session.variables.discordAuth.userdata;

            let tags = verySadDatabase [ filename ];
            let genrelist = '<option value=12">Other</option>';
            for(key in genres) {
                genrelist += `<option value="${key}"${tags.genre == key ? ' selected' : ''}>${genres[key].name}</option>`;
            }
            WebServer.renderTemplate ( 'songedit', request, response,
            {
                songauthor: tags.artist ? tags.artist : '',
                songname: tags.title ? tags.title : '',
                songalbum: tags.album ? tags.album : '',
                genrelist: genrelist,
                username: userdata.username,
                useravatar: 'https://cdn.discordapp.com/avatars/' + userdata.id + '/' + userdata.avatar + '.png',
                discriminator: userdata.discriminator,
                song: requestData.query.title
            } );

            response.end();
        }
        else
        {
            WebServer.redirect ( request, response, '/' );
        }
    }
    else
    {
        WebServer.redirect ( request, response, '/' );
    }
} );

WebServer.registerRequestHandler ( '/auth', function ( request, response, requestData, cookies, session )
{
    if ( session.variables.discordAuth ) return WebServer.redirect ( request, response, '/upload' );

    if ( requestData.query && requestData.query.code && !session.variables.discordAuth )
    {
        let code = requestData.query.code;

        requestlib.post ( {
            url: 'https://discordapp.com/api/oauth2/token',
            form:
            {
                client_id: Config.client_id,
                client_secret: Config.client_secret,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: Config.discord_auth.redirect_uri,
                scope: 'identify'
            }
        }, function ( error, res, body )
        {
            if ( !error )
            {
                let json = JSON.parse ( body );

                if ( json.access_token )
                {
                    // return WebServer.redirect ( request, response, 'https://localhost:3000/upload' );
                    verifyUserCredentials ( json.access_token, json.token_type, function ( userdata )
                    {
                        logger.log ( '[Info/WebServer] Authenticated discord user ' + userdata.id );

                        session.variables.discordAuth = { };
                        session.variables.discordAuth.data = json;
                        session.variables.discordAuth.userdata = userdata;

                        return WebServer.redirect ( request, response, 'upload' );
                    }, function ( )
                    {
                        response.writeHead ( 200, { 'Content-Type': 'text/html' } );
                        response.write ( '<h1>Auth Failed</h1>' );
                        response.end ( );
                    } );
                }
                else return WebServer.redirect ( request, response, '/' );
            }
            else throw new Error ( error );
        } );
    }
    else
    {
        logger.log ( '[Info/WebServer] Invalid Auth, no code provided. Redirecting...' );
        return WebServer.redirect ( request, response, Config.discord_auth.redirect );
    }
} );

WebServer.registerRequestHandler ( '/get_asset', function ( request, response, requestData, cookies, session )
{
    let skin = './assets/default';
    let cookieSkin = cookies.get ( 'skin_id' );

    if ( !cookieSkin )
    {
        cookieSkin = Config.enabled_skins [Math.floor ( Math.random ( ) * Config.enabled_skins.length )];
        cookies.set ( 'skin_id', cookieSkin, { expires: new Date ( Date.now ( ) + 5 * 60 * 1000 ) } );

        logger.log ( '[Info/WebServer] random skin selected: ' + cookieSkin );
    }

    cookieSkin = String ( cookieSkin );
    cookieSkin = cookieSkin.replace ( /[^a-zA-Z0-9-_]+/ig, '' );
    cookieSkin = './assets/' + cookieSkin;

    if ( cookieSkin && fs.existsSync ( cookieSkin ) && fs.lstatSync ( cookieSkin ).isDirectory ( ) )
        skin = cookieSkin;

    if ( requestData.query.name )
    {
        let resourceName = requestData.query.name.replace ( /[^a-zA-Z0-9-_\.]+/, '' );
        let fullPath = skin + '/' + resourceName;

        if ( fs.existsSync ( fullPath ) )
        {
            let mimeType = WebServer.getMimeType ( fullPath );
            let stat = fs.statSync ( fullPath );

            response.writeHead ( 200,
            {
                'Content-Type': mimeType,
                'Content-Length': stat.size
            } );

            let readStream = fs.createReadStream ( fullPath )
            readStream.pipe ( response );
        }
        else
        {
            response.writeHead ( 404, { 'Content-Type': 'text/html' } );
            response.write ( '<h1>Not Found</h1>' );
            response.end ( );
        }
    }
    else
    {
        response.writeHead ( 200, { 'Content-Type': 'text/html' } );
        response.end ( );
    }
} );

WebServer.registerRequestHandler ( '/template_test', function ( request, response, requestData, cookies, session )
{
    response.writeHead ( 200, { 'Content-Type': 'text/html' } );

    WebServer.renderTemplate ( 'uploadform', request, response,
    {
        username: 'huj',
        useravatar: 'https://cdn.discordapp.com/avatars/276791868141076480/4a3736a3aa445bec61dde599040d0ec7.png',
        discriminator: '6969'
    } );

    response.end ( );
} );
