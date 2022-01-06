require("dotenv").config();
const fs = require("fs");
const express = require("express");
const moment = require("moment");
const ExcelJS = require("exceljs");
const qrcode = require("qrcode-terminal");
const qr = require("qr-image");
const { Client, MessageMedia } = require("whatsapp-web.js");

/**
 * ⚡⚡⚡ DECLARAMOS LAS LIBRERIAS y CONSTANTES A USAR! ⚡⚡⚡
 */
const respuestas = require("../flow/respuestas.json");
const messages = require("../flow/mensajes.json");
const opciones = require("../flow/opciones.json");

const mongo=require("./mongo.js")

const app = express();
app.use(express.urlencoded({ extended: true }));

const SESSION_FILE_PATH = `${process.cwd()}/session.json`;
let client;
let sessionData;

let writeStream = fs.createWriteStream('secret.txt');

/**
 * Enviamos archivos multimedia a nuestro cliente
 * @param {*} number
 * @param {*} fileName
 */
const sendMedia = (number, fileName, text = null) =>
  new Promise((resolve, reject) => {
    number = number.replace("@c.us", "");
    number = `${number}@c.us`;
    const media = MessageMedia.fromFilePath(`./mediaSend/${fileName}`);
    const msg = client.sendMessage(number, media, { caption: text || null });
    resolve(msg);
  });

/**
 * Enviamos un mensaje simple (texto) a nuestro cliente
 * @param {*} number
 */
const sendMessage = (number = null, text = null) =>
  new Promise((resolve, reject) => {
    number = number.replace("@c.us", "");
    number = `${number}@c.us`;
    const message = text;
    const msg = client.sendMessage(number, message);
    console.log(`⚡⚡⚡ Enviando mensajes....`);
    resolve(msg);
  });

/**
 * Clear number
 */

const clearNumber = (number) => {
  number = number.replace("@c.us", "");
  number = `${number}`;
  return number;
};

/**
 * Revisamos si tenemos credenciales guardadas para inciar sessio
 * este paso evita volver a escanear el QRCODE
 */
const withSession = () => {
  console.log(`Validando session con Whatsapp...`);
  sessionData = require(SESSION_FILE_PATH);
  client = new Client({
    session: sessionData,
    puppeteer: {
      args: ["--no-sandbox"],
    },
  });

  client.on("ready", () => {
    console.log("Client is ready!");
    connectionReady();
  });

  client.on("auth_failure", () => {
    console.log(
      "** Error de autentificacion vuelve a generar el QRCODE (Debes Borrar el archivo session.json) **"
    );
  });

  client.initialize();
};
const withOutSession = () => {
  console.log(
    `🔴🔴 No tenemos session guardada, espera que se generar el QR CODE 🔴🔴`
  );

  client = new Client({
    puppeteer: {
      args: ["--no-sandbox"],
    },
  });
  client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    generateImage(qr);
  });

  client.on("ready", () => {
    console.log("Client is ready!");
    connectionReady();
  });

  client.on("auth_failure", () => {
    console.log("** Error de autentificacion vuelve a generar el QRCODE **");
  });

  client.on("authenticated", (session) => {
    // Guardamos credenciales de de session para usar luego
    sessionData = session;
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
      if (err) {
        console.log(err);
      }
    });
  });

  client.initialize();
};

const connectionReady = () => {
  client.on("message", async (msg) => {
    let { body } = msg;
    const { from, to } = msg;
    let step = await readChat(from, body);
    body = body.toLowerCase();

    if (respuestas.STEP_1.includes(body)) {
      console.log("STEP1", body);
      sendMessage(from, messages.STEP_1.join(""));
      return;
    }
    
    if (respuestas.STEP_2.includes(body)) {
      const step2 = messages.STEP_2.join("");
      const parseLabel = Object.keys(opciones)
        .map((o) => {
          return opciones[o]["label"];
        })
        .join("");

      sendMessage(from, step2);
      sendMessage(from, parseLabel);
      resp = await readChat(from, body, "STEP_2_1");

      return;
    }

    if (opciones[body.toUpperCase()]) {
      const optionSelected = opciones[body.toUpperCase()];

      sendMessage(from, optionSelected.main.message);

      const options = Object.keys(optionSelected.list).map((option) => optionSelected.list[option].message);

      sendMessage(from, options.join("\n"));
    }

    const letterOptions = ['J','C','A','U','P']
    const optionWithLetter = body.toUpperCase()
    const letter = optionWithLetter.split('')[0]
    
    if(letterOptions.includes(letter)){
        const options = Object.keys(opciones).map(optionKey => {
          if (opciones[`${optionKey}`].list[body.toUpperCase()] !== undefined){
            return opciones[`${optionKey}`].list[body.toUpperCase()]
          }
        })

        const getMainOption = {
          J: 'juzgados',
          C: 'consejo',
          A: 'administracion',
          U: 'universidad',
          P: 'presidencia'
        }

        retiveLastTurn(body, getMainOption[letter])

        options.forEach(option => {
          if (option !== undefined) {
            sendMessage(from, `Elegiste ${option.message}`);
          }
        })
        
    }

  });
};

const retiveLastTurn = async (subOption, mainOption) => {
  const Mongodb = new mongo();

 const last = await Mongodb.getlast(mainOption)
  
  if (last.length === 0){
    Mongodb.insert(mainOption, {
      createdAt: new Date(),
      ticket: `${subOption}-0`
    })
  } else {
    console.log(last)
    const turn = last[0].ticket.split('-')[1]

     Mongodb.insert(mainOption, {
      createdAt: new Date(),
      ticket: `${subOption}-${parseInt(turn) + 1}`
    })
  }
}


/**
 * Guardar historial de conversacion
 * @param {*} number
 * @param {*} message
 */
const readChat = (number, message, step = null) =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      number = number.replace("@c.us", "");
      number = `${number}@c.us`;
      const pathExcel = `./chats/${number}.xlsx`;
      const workbook = new ExcelJS.Workbook();
      const today = moment().format("DD-MM-YYYY hh:mm");

      if (fs.existsSync(pathExcel)) {
        /**
         * Si existe el archivo de conversacion lo actualizamos
         */
        const workbook = new ExcelJS.Workbook();
        workbook.xlsx
          .readFile(pathExcel)
          .then(() => {
            const worksheet = workbook.getWorksheet(1);
            const lastRow = worksheet.lastRow;
            let getRowInsert = worksheet.getRow(++lastRow.number);
            getRowInsert.getCell("A").value = today;
            getRowInsert.getCell("B").value = message;

            if (step) {
              getRowInsert.getCell("C").value = step;
            }

            getRowInsert.commit();
            workbook.xlsx
              .writeFile(pathExcel)
              .then(() => {
                const getRowPrevStep = worksheet.getRow(lastRow.number);
                const lastStep = getRowPrevStep.getCell("C").value;
                resolve(lastStep);
              })
              .catch((err) => {
                console.log("ERR", err);
                reject("error");
              });
          })
          .catch((err) => {
            console.log("ERR", err);
            reject("error");
          });
      } else {
        /**
         * NO existe el archivo de conversacion lo creamos
         */
        const worksheet = workbook.addWorksheet("Chats");
        worksheet.columns = [
          { header: "Fecha", key: "number_customer" },
          { header: "Mensajes", key: "message" },
          { header: "Paso", key: "step" },
        ];

        step = step || "";

        worksheet.addRow([today, message, step]);
        workbook.xlsx
          .writeFile(pathExcel)
          .then(() => {
            resolve("STEP_1");
          })
          .catch((err) => {
            console.log("Error", err);
            reject("error");
          });
      }
    }, 150);
  });

const generateImage = (base64) => {
  let qr_svg = qr.image(base64, { type: "svg", margin: 4 });
  qr_svg.pipe(require("fs").createWriteStream("qr-code.svg"));
  console.log(`⚡ Recuerda que el QR se actualiza cada minuto ⚡'`);
  console.log(`⚡ Actualiza F5 el navegador para mantener el mejor QR⚡`);
  console.log("http://localhost:9000/qr");
};

const handleExcel = (number, step = null) =>
  new Promise((resolve, reject) => {
    const proccessChild = (row) =>
      new Promise((resolve) => {
        const stepFind = row.values[3] || null;
        resolve({
          value: row.values[2] || null,
          step: stepFind,
        });
      });

    let rowsList = [];
    setTimeout(() => {
      number = number.replace("@c.us", "");
      number = `${number}@c.us`;
      const pathExcel = `./chats/${number}.xlsx`;
      const workbook = new ExcelJS.Workbook();
      if (fs.existsSync(pathExcel)) {
        /**
         * Si existe el archivo de conversacion lo actualizamos
         */

        workbook.xlsx
          .readFile(pathExcel)
          .then(() => {
            const worksheet = workbook.getWorksheet(1);
            worksheet.eachRow((row) => rowsList.push(proccessChild(row)));
            Promise.all(rowsList).then((listPromise) => {
              const listRev = listPromise.reverse();
              if (step) {
                const findStep = listRev.find((o) => o.step === step);
                resolve(findStep);
              } else {
                reject("error");
              }
            });
            resolve;
          })
          .catch((err) => {
            console.log("ERR", err);
            reject("error");
          });
      }
    }, 150);
  });

/**
 * Revisamos si existe archivo con credenciales!
 */
fs.existsSync(SESSION_FILE_PATH) ? withSession() : withOutSession();

/** QR Link */

app.get("/qr", (req, res) => {
  res.writeHead(200, { "content-type": "image/svg+xml" });
  fs.createReadStream(`./qr-code.svg`).pipe(res);
});

app.get("/ticket/:mainOption", async (req, res) => {
  const { mainOption } = req.params
  const db = new mongo();
  const last = await db.getlast(mainOption)

  if (last.length > 0) {
    res.status(200).json({
      turn: last[0].ticket
    })
  }
});

app.listen(8000, () => {
  console.log("Server ready!");
});

