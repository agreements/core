var advQuery = require('./advquery');
var utility = require('./utility');
var constants = require('./constants.json');
var queries = require('./queries');
var db = require('./db');
var generatePositionData = utility.generatePositionData;
module.exports = function fillPlayerData(player, options, cb) {
    //options.info, the tab the player is on
    //options.query, the querystring from the user, pass these as select conditions
    //defaults: this player, balanced modes only, put the defaults in options.query
    var js_agg = null;
    var limit = null;
    var query = Boolean(Object.keys(options.query).length);
    if (options.info === "index" && player.cache && !query) {
        console.log("using cache");
        js_agg = {};
        limit = 10;
    }
    var default_select = {
        "players.account_id": player.account_id.toString(),
        "significant": "1"
    };
    for (var key in default_select) {
        options.query[key] = options.query[key] || default_select[key];
    }
    advQuery({
        select: options.query,
        project: null, //just project default fields
        js_agg: js_agg,
        js_sort: {
            match_id: -1
        },
        limit: limit
    }, processResults);

    function processResults(err, results) {
        //delete all_players from each match, remove parsedPlayer from each player, dump matches into js var, use datatables to generate table
        results.data.forEach(function reduceMatchData(m) {
            delete m.all_players;
            delete m.parsed_data;
            m.players.forEach(function(p) {
                delete p.parsedPlayer;
            });
        });
        //currently, always refresh cache if not hitting index and if no query
        if ((!player.cache || true) && options.info !== "index" && !query) {
            player.cache = {
                aggData: {}
            };
            var cachedKeys = {
                "win": 1,
                "lose": 1,
                "games": 1,
                "heroes": 1,
                "teammates": 1
            };
            for (var key in cachedKeys) {
                player.cache.aggData[key] = results.aggData[key];
            }
            player.cache.data = results.data.slice(0, 10);
            db.players.update({
                account_id: player.account_id
            }, {
                $set: {
                    cache: player.cache
                }
            }, {
                upsert: true
            }, function(err) {
                //if cache doesn't exist, save the cache
                finish(err, results);
            });
        }
        else {
            //otherwise use the cache
            finish(err, player.cache);
        }
    }

    function finish(err, results) {
        if (err) {
            return cb(err);
        }
        var aggData = results.aggData;
        //get teammates, heroes, convert hashes to arrays and sort them
        if (aggData.heroes) {
            var heroes_arr = [];
            var heroes = aggData.heroes;
            for (var id in heroes) {
                var h = heroes[id];
                heroes_arr.push(h);
            }
            heroes_arr.sort(function(a, b) {
                return b.games - a.games;
            });
            aggData.heroes = heroes_arr;
        }
        if (aggData.teammates) {
            var teammates_arr = [];
            var teammates = aggData.teammates;
            for (var id in teammates) {
                var tm = teammates[id];
                id = Number(id);
                //don't include if anonymous or if less than 3 games
                if (id !== player.account_id && id !== constants.anonymous_account_id && tm.games >= 3) {
                    teammates_arr.push(tm);
                }
            }
            teammates_arr.sort(function(a, b) {
                return b.games - a.games;
            });
            aggData.teammates = teammates_arr;
        }
        if (aggData.obs) {
            //generally position data function is used to generate heatmap data for each player in a natch
            //we use it here to generate a single heatmap for aggregated counts
            player.obs = aggData.obs.counts;
            player.sen = aggData.sen.counts;
            var d = {
                "obs": true,
                "sen": true
            };
            generatePositionData(d, player);
            player.posData = [d];
        }
        console.time('teammate_lookup');
        queries.fillPlayerNames(aggData.teammates, function(err) {
            console.timeEnd('teammate_lookup');
            player.matches = results.data;
            player.aggData = results.aggData;
            cb(err, player);
        });
    }
}