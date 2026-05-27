# How To Run The Bot
1. Clone the repository and navigate to the project directory.
```
git clone https://github.com/xenoncolt/sushi-discord-bot.git
```
or 
Download the zip and extract it.

2. Install the dependencies using npm.
```
npm install
```
3. Rename the `example.env` file to `.env` and fill in your Discord bot token.

~~4. Update the `config/config.json` file with the appropriate IDs for your server, channels.~~ [This step is no longer needed as the bot now saves the event data to a database instead of a config file.]

5. Build the js code from the ts source.
```
npm run build
```
6. Move the built js files to the another root directory (or where you want to run the bot) and copy the config folder and `.env` file there.
7. Run the bot using node.
```
node index.js
```