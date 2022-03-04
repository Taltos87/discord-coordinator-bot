import 'dotenv/config'
import { notion } from "../handlers/notion-handler.js";
import { channel,discord,newEmbed } from "../handlers/discord-handler.js";
import { monday,mmdd } from '../extra/scheduler.js';
import { CronJob } from 'cron'
import { tweet } from "../handlers/twitter-handler.js";
import  weather from 'weather-js';
import { MessageEmbed } from 'discord.js';
import moment from 'moment';
var stored = []; 
/*
export var MoveTodaysLeftTask = async()=>{
    var pages = await notion.getPages( notion.databases["Worklog"] );
    var columns = await notion.getColumns( pages[0].id );
    var today = new Date().getDay() -1 ; 
    var TodaysColumn = columns[today];
    var blocks = await notion.getChildren( TodaysColumn.id, {type:'to_do'} );
    blocks = blocks.filter( b => !b.to_do.checked )

    blocks.forEach( async b =>{
        await notion.createNew( notion.databases["Tasks"] , {Name: b.to_do.text[0].plain_text} , null )
        await notion.deleteItem(b.id)
    })
    var text = "I just moved today's left tasks to [Tasks]" 
    channel.send(text)
}
*/ 


var getNotionDate = _date=>{ return _date.toISOString().split('T')[0] }

export var CreateNewLog = async () =>{

    var BUILD = async ( _container ) =>{
        var allowed = ["to_do", "heading_1","heading_2", "heading_3", "column", "column_list" ]
        var all = _container.body.filter( i => allowed.includes(i.type) )
        all =  await notion.itemFilter( all,  {checked: true } );
        var leftTodo = all.filter(item => item.type == 'to_do' );
        _container.header = _container.header.concat(leftTodo);
        _container.body = all.filter( item => !leftTodo.includes(item) ) 
        return _container;
    }

    var style = { Name : mmdd(monday) }
    style.Date = {start :getNotionDate(monday)  }

    channel.send("Do you want me to create new 📒log?")
    
    stored.action = async() =>{
        var newPage =  await notion.createNew( notion.databases["Worklog"] , style ,BUILD ); 
        /*
        if( newPage.children.length > 0 ){
            await notion.spreadItem( newPage , 7 );
        }
        */ 
        channel.send(`Here it is!`) 
        var _newEmbed = newEmbed( {description :` [📒${mmdd(monday)}](${newPage.url}) `} )
        channel.send({embeds : [_newEmbed] })
    }
}

export async function clearChannel(){
    Promise.resolve( await channel.messages.fetch({limit: 100}) )
      .then( fetched =>{
        channel.bulkDelete(fetched);
        channel.send(`Awesome New Beginning❤️`)
      })
}

var getCalendar = (wit_datetime ) =>{
    return [wit_datetime].map( t => {
        var _t = t.split("T");
        return {
            min:  _t[1].split(":")[1],
            hour:  _t[1].split(":")[0],
            day : _t[0].split("-")[2],
            month : _t[0].split("-")[1],
            year : _t[0].split("-")[0],
        }
    })[0];
}

var allCrons =[];
export async function initCrons( pages ){

    pages.forEach(  reminder => {
        var P = reminder.properties; 
        var cronTime = P['Cron Time'].formula.string;
        var name = P['Name'].title[0].plain_text 
        var messages = P['Messages'].rich_text.length > 0 ? (P['Messages'].rich_text[0].plain_text).split(',') : [] ; 
        var script = P['Script'].rich_text.length > 0 ? P['Script'].rich_text[0].plain_text  : null ;  
        
        var cron = new CronJob( cronTime , ()=>{
            if( messages.length > 0 ){sendAlarm( messages[Math.floor( messages.length*Math.random() )] )}
            else{ sendAlarm( "it's time for "+ name +" ✨");}
            if(script){eval(script);}     
        }, null, null , process.env.TIMEZONE);
        allCrons.push(cron);
        cron.start(); 
       
    })
    

}

export async function respondYes( ){
    if(stored.action){
        stored.action(); 
        stored = {}
    }
}
export async function respondNo( ){
    if(stored.action){
        stored = {}
        channel.send("No problem!👍")
    }
}

export async function createReminder(entitie){
    console.log( entitie )
    // 0. sort
    var _agenda = entitie.agenda_entry ? entitie.agenda_entry : "something" ;
    var style = { Name : _agenda };
    if('duration' in entitie){
        //it's recurring task
        style.Unit = Object.keys(entitie.duration)[0] ;
        style.Recurring = Object.values(entitie.duration)[0] ;
    }
    if('datetime' in entitie ){
        //it's one time event
        var CAL = getCalendar(entitie.datetime);
        style.Date = {start : CAL.year +"-" + CAL.month +"-"+CAL.day , end: null }
    }

    // 1. check up message
    var _newEmbed = new MessageEmbed();
    _newEmbed.setTitle("⏰ Reminder");
    Object.keys(style).forEach( k=>{
        _newEmbed.addFields({name : k , value :style[k].toString(),inline:true})
    })
    channel.send({embeds : [_newEmbed] })
    channel.send("Want me to create like this?")


    stored.action = async() =>{
        
        // 1. add notion
        var page = await notion.createNew( notion.databases["Reminders"] , style ,null ); 
        var cronTime = await page.properties['Cron Time'].formula.string ;
   
        // 2. set Cron
        var newCron = new CronJob(cronTime ,()=>{ sendAlarm( _agenda ) },null, null , process.env.TIMEZONE);
        allCrons.push(newCron);
        newCron.start();

        channel.send("I added a new reminder for you!")
            
    }


}

export var tellMeAboutReminders = async () =>{
    // 1. get
    var reminders = await notion.getPages( notion.databases["Reminders"] );
    reminders = reminders.map( item => 
            { return  {  Name : item.properties.Name.title[0].plain_text,
                        Date : item.properties.Date.date.start,
                        Recurring : item.properties.Recurring.number,
                        Unit : item.properties.Unit.select ? item.properties.Unit.select.name   : null ,
                        URL : item.url,
                        id: item.id
                    }
            } )
    stored.datas = reminders; 
    // 2. Create Message 
    
    var _embed = newEmbed({title: "⏰ All Reminders"})
                 
    for( var i = 0 ; i < reminders.length ; i ++ ){
        var _time = reminders[i].Date;
        _embed.addFields({ name : _time , value : `[ ${i}. ${reminders[i].Name} ](${reminders[i].URL} )` } )
    }

    channel.send({embeds : [_embed] })  

    stored.datas = reminders; 
    return reminders;
}


export var deleteSelected = async ( _entities ) =>{

    if( !stored.datas ){
        channel.send("hmmm.... delete from where? 😗❔ ")
    }

    else{
        channel.send("I can delete if you want!")
        stored.action = async () =>{
            var numbers = _entities['number']
            numbers = numbers.map( numb => numb.value )
            for (var i = 0; i < numbers.length ; i ++  ){
                var ID = numbers[i]
                ID= stored.datas[ID].id 
                await notion.deleteItem(  ID  )
            }
            channel.send( 'Mission Complete! I deleted ' + numbers.length + "  items 🙌" ) 
        }

    }
    
}

var sendAlarm = ( message ) =>{channel.send("⏰"+ message );}

var lineChange = `
`

/*
export var spreadTodo = async ()=>{
    var pages = await notion.getPages( notion.databases["Worklog"] );
    var latest = pages[0];
    notion.spreadItem(latest , 7 ); 
}*/ 

export var tweetThat = async ()=>{

    await channel.messages.fetch( {limit:5} ).then( messages =>{

        // 0. Clean up
        messages = messages.filter( msg => !msg.author.bot );
        var keys = Array.from(messages.keys())
        //delete keys[0]

        // 1. Assign         
        var textBody = messages.get(keys[1]).content.length != 0 ?
                    messages.get(keys[1]).content : messages.get(keys[2]).content;

        var mediaURLs = messages.get(keys[1]).attachments.size ?
                        messages.get(keys[1]).attachments :
                        messages.get(keys[2]).attachments.size ?
                        messages.get(keys[2]).attachments  : new Map() ;
         
        if( mediaURLs.size > 0 ){
            mediaURLs = Array.from( mediaURLs.values() )
            mediaURLs = mediaURLs.map( media => media.attachment )
        }      

        // 2. Create Message 
        
        var tweetPreview = newEmbed({title: "💬 Your Tweet " ,description : textBody }) ;
        if(mediaURLs){tweetPreview.setImage(mediaURLs[0])}
        channel.send({embeds : [tweetPreview] })
        

        // 3. Post Tweet
        stored.action = () =>{
            tweet( textBody, mediaURLs )
        }

    })
}

//https://github.com/devfacet/weather
export function getWeather( _embeded , _city ){
    return new Promise(async (resolve,error)=>{
        weather.find({search: _city, degreeType: 'F'}, function(err, result) {
            var data = result[0];
            _embeded
                .setThumbnail(data.current.imageUrl)
                .addField("Sky Condition", data.current.skytext, true)
                .addField("Temperature", data.current.temperature, true)
                .addField("Day", data.current.day, true)
                resolve(_embeded)
          });      
    })
}

var witTimeToDate = _witTime =>{
    return new Date(_witTime.split('T')[0].replace('-',','))
}

export var TellMeAboutTasks = async (_entitie) =>{
    var date = 'datetime' in _entitie ? witTimeToDate(_entitie.datetime) : new Date()
    var day =  date.getDay();
    day = day == 0 ? 6: day - 1;  //start of the week is monday
    var pages = await notion.getPages( notion.databases["Worklog"] );
    var columns = await notion.getColumns( pages[0] ) ; 

    Promise.resolve( getTasks(day,columns ) ).then( async ([allTodo, leftTodo] )=>{
        var text = "" ; 
        var _newEmbed = new MessageEmbed();
        _newEmbed.setTitle (  "🌈 " + date.toDateString()  ); 
        if("how_many" in _entitie){
            text = "You have  " + leftTodo.length.toString() +"/" + allTodo.length.toString() +" tasks" ;
            _newEmbed.setDescription( text ); 
        }
        else{
            stored.datas = await !"remain" in _entitie ? allTodo : leftTodo ;
            text = await notion.blocks_to_text( stored.datas );
            _newEmbed.setDescription( text ); 
        }
        channel.send({embeds : [_newEmbed] })
        var nextColumn = columns[Math.min(day + 1, columns.length)]
        askBusy( 10 ,leftTodo , nextColumn ); 
    })

}

var getTasks = async( day , columns ) =>{
    //var columns = await notion.getColumns( page );
    var TodaysColumn = columns[day]; 
    var allTodo = await notion.getChildren( TodaysColumn, {type:'to_do'} );
    allTodo = await allTodo.filter(b => b.to_do )
    var leftTodo = await allTodo.filter( b => !b.to_do.checked );
    return [allTodo, leftTodo]; 
}



var notionDateToDate = (stringDate) =>{
    var Cal = stringDate.split("-").map(i => parseInt(i) )
    return new Date(Cal[0], Cal[1]-1, Cal[2]); // ⬜ month number seems larger...
}


export var TellMeAboutProject = async (_entitie)=>{

    var Now = new Date(); 
    var AllProjects = await notion.getPages( notion.databases["Projects"] );
    var Scheduled = AllProjects.filter( p => p.properties.Date.date != null && p.properties.Date.date.end != null )
    var Completed = Scheduled.filter( p => Now.getTime() >= notionDateToDate(p.properties.Date.date.end).getTime() )
    var Incompleted = Scheduled.filter( p => !Completed.includes(p));

    var Project ; 
    if ('next' in _entitie ){
        Project = Incompleted[1] 
    }
    else if ( 'previous' in _entitie ){
        Project = Completed.at(-1)
    }
    else{
        Project = Incompleted[0] 
    }

    if( Project ){
        //found
        var title = Project.properties.Name.title[0].plain_text; 
        var start = Project.properties.Date.date.start; 
        var end = Project.properties.Date.date.end; 
        var leftDays =  Math.floor( (notionDateToDate(end) - Now)/(1000 * 60 * 60 * 24) );
        leftDays = leftDays < 2 ? leftDays.toString() +" day" :leftDays.toString() +" days"
        
        var _embeded = new MessageEmbed()
        _embeded.setDescription(`[ 🏞️ **${title}** ](${Project.url})`)
        var text =[]
        
        if('next' in _entitie){
            const startIn = moment(start).endOf('day').fromNow();
            text.push("◽ Start in " + startIn)
        }
        else if ( 'previous' in _entitie ){
            text.push("◽ Started " + start )
            text.push("◽ Due is " + end )
        }
        else{
            text.push("◽ Due is " + leftDays + lineChange)

            //_embeded.addFields({name :'⭐Left' , value : leftDays, inline : true })
        }

       var Text = ''
       for(var i = 0; i < text.length; i++){
            Text += text[i];
           if( i != text.length ){    Text+= lineChange; }
       }

        _embeded.addFields({name :'Information' , value : Text })
       channel.send({embeds : [_embeded] }) 
    }
    else{
        channel.send(
`You don't have any specific project assigned!
Do anything you like!❤`)
    }
 

}





export async function botIn(){
    // When a bot initiate, all the reminder except daily event starts.
    var reminders = await notion.getPages( notion.databases["Reminders"] );
    reminders = await reminders.filter( data => data.properties.Unit.select == null || !['minute','hour','day'].includes(data.properties.Unit.select.name)    )
    //initCrons(reminders);     
}
export async function userIn(){
    console.log("You are in!")
    var messages = ['Hello!','You came back!',"Hey Darling!"];  
    channel.send( messages[Math.floor( Math.random() * messages.length )]);

    var reminders = await notion.getPages( notion.databases["Reminders"] );
    reminders = reminders.filter( data => data.properties.Unit.select == null || ['minute','hour','day'].includes(data.properties.Unit.select.name)    )
    initCrons(reminders); 

    //
    var _embeded = new MessageEmbed().setTitle(` ♥ Let's start Today `)

    // 0. weather
    await getWeather( _embeded , 'Vancouver, BC');

    // 1. todo 
    var day = new Date().getDay()
    day = day == 0 ? 6: day - 1; 
    var pages = await notion.getPages( notion.databases["Worklog"] );

    var columns = await notion.getColumns( pages[0] ) ; 
    Promise.resolve( getTasks(day, columns ) ).then( async ( [ allTodo , leftTodo ] ) =>{

        var todos = await notion.blocks_to_text(allTodo);     
        _embeded.addFields({name : "Tasks", value : todos})
        _embeded.addFields({name : "Count", value : `${allTodo.length-leftTodo.length}/${allTodo.length}`})
    
        // 9. send
        channel.send({embeds : [_embeded] }) 
    
        // 9. if task is too many
        var nextColumn = columns[Math.min(day + 1, columns.length)]
        askBusy(10, leftTodo , nextColumn ); 
    })    
}

async function askBusy( _maxCount , tasks , moveGoal ){
    if( tasks.length > _maxCount ){
        const messages = [`😲You are too busy today!
Do you want me to move some tasks to tmr?`];
        var leftArr = tasks.slice(_maxCount) ;
        channel.send( messages[Math.floor( messages.length * Math.random() )] )
        stored.action = async() =>{
            leftArr.forEach(async task =>{
                await notion.parent( task, moveGoal )
            })
        }
    }
}


export async function userOut(){
    console.log("You are out!")
    var messages = ["Bye! Have a good day!" ,"See ya!"]
    channel.send( messages[Math.floor( Math.random() * messages.length )]);

    allCrons.forEach( item => { item.stop();} )
    allCrons = []; 
}

export async function TellMeAboutLocation(_entitie){
    var location = "location" in _entitie ? _entitie.location.name : "Vancouver"
    
    // 1. Create Embed
    var _newEmbed = new MessageEmbed();
    _newEmbed.setTitle( "🗺️ " + location );

    if( "time" in _entitie ){
        var requestTime = new Date();
        var localTime = moment.tz( requestTime , _entitie.location.timezone ).format('LT');
        _newEmbed.setFields({name : "Local Time", value : localTime} )
    }
    
    if("weather" in _entitie){
        _newEmbed = await getWeather(_newEmbed , location ); 
    }

    // 2. Send
    if(!_newEmbed.description &&  !_newEmbed.fields ){}
    else{channel.send({embeds : [_newEmbed] })}

}