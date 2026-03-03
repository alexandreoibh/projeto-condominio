const express = require('express');
const router = express.Router();
const dotenv = require('dotenv').config()
const app = express();
const cron = require('node-cron');
const APP_URL = process.env.APP_URL;
const AcoesControllerItem = require("../controllers/acoesController");
const acoesContr = new AcoesControllerItem();
const axios = require("axios");

function data_ret() {
    let today = new Date();
    let day = today.getDate() + "";
    let month = (today.getMonth() + 1) + "";
    let year = today.getFullYear() + "";
    let hour = today.getHours() + "";
    let minutes = today.getMinutes() + "";
    let seconds = today.getSeconds() + "";
    

    return day + "/" + month + "/" + year + " " + hour + ":" + minutes + ":" + seconds;
}


function day_ret() {
    let today = new Date();
    let day = today.getDay();
    return day;
}

const getParamsAndSchedule = async (req, res) => {

    let data = data_ret();
    let day = day_ret();
    console.log('Start Process Jobs tasks.........' + data+"-------------"+day);

    const task = cron.schedule('1 1 */2 * * *', async () => {
        let data = data_ret();
        let today = new Date();
        let hour = today.getHours();
        let day = day_ret();
        console.log('Start Task 1 -> ' + data);

        if ((hour > 12 && hour <= 23) && day!=0 && day!=6) {
            await axios.post(`${process.env.APP_URL}/acoes/symbolSetOnLine`).then(result => {
                console.log('Success task 1 -> ' + data);
            }).catch(e => {
                console.log('Error task 1 -> ' + data);
                console.log({ error: e.message });
            });
        } else {
            console.log('Task 1 out time permission  -> ' + data);
        }
        console.log('End Task 1');
    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });

    const task2 = cron.schedule('*/4 5 3 5 * *', async () => {
        let data = data_ret();
        let today = new Date();
        let hour = today.getHours();
        let day = day_ret();
        console.log('Start Task 2 -> '+hour+""+ data+"---"+day);

        // await axios.post(`${process.env.URL_SERVER}/acoes/symbolSetOnLine`).then(result => {

        //     console.log('Success! ');

        // }).catch(e => {

        //     console.log('Error!');

        //     console.log({ error: e.message });

        // });
        console.log('End Task 2 -> ' + data);
    }, {

    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });




    return task;
}



module.exports = getParamsAndSchedule().then(task => task);


