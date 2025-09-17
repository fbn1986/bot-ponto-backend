// --- Dependências ---
const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

// --- Configuração do Firebase ---
const serviceAccount = require(`./${process.env.FIREBASE_SERVICE_ACCOUNT_FILE}`);
const appId = 'default-app-id';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('Firebase Admin SDK inicializado com sucesso.');

// --- Configuração do Servidor Express ---
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Rota Principal ---
app.get('/', (req, res) => {
  res.send('Servidor do Bot de Ponto está a rodar! Configure o webhook para a rota /webhook.');
});

// --- ROTA DO WEBHOOK ---
app.post('/webhook', async (req, res) => {
  console.log('Webhook recebido!');
  
  try {
    if (req.body.event !== 'messages.upsert') {
      console.log(`Evento ignorado: ${req.body.event}`);
      return res.sendStatus(200);
    }

    console.log(JSON.stringify(req.body, null, 2));

    const messageData = req.body.data;
    const messageBody = messageData.message?.conversation;
    const sender = messageData.key?.remoteJid;

    if (!messageBody || !sender || messageData.key?.fromMe) {
      console.log('Mensagem inválida, de mim, ou sem corpo/remetente.');
      return res.sendStatus(200);
    }
    
    const senderId = sender.split('@')[0];
    const command = messageBody.toLowerCase().trim();
    let replyText = 'Comando inválido. Por favor, envie "Entrada" ou "Saída".';

    if (command === 'entrada' || command === 'saída') {
      await addRecord(senderId, command);
      const horaCorreta = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      replyText = `✅ Ponto de *${command}* registado com sucesso às ${horaCorreta}!`;
    } 
    else if (command.startsWith('relatório')) {
        replyText = await handleReportCommand(senderId, command);
    }
    else if (command === 'gerardadosficticios') {
        replyText = await generateMockData(senderId);
    }

    await sendReply(sender, replyText);

  } catch (error) {
    console.error('Erro ao processar o webhook:', error.message);
    if (error.stack) {
        console.error(error.stack);
    }
  }

  res.sendStatus(200);
});


// --- Funções de Comando ---

async function handleReportCommand(userId, command) {
    const tokens = command.split(' ');
    let startDate, endDate = new Date();

    const hoje = new Date();
    hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (tokens.includes('até')) {
        const dataInicioIndex = tokens.indexOf('relatório') + 1;
        const dataFimIndex = tokens.indexOf('até') + 1;
        startDate = parseDate(tokens[dataInicioIndex]);
        endDate = parseDate(tokens[dataFimIndex]);
    } else if (tokens.includes('últimos')) {
        const diasIndex = tokens.indexOf('dias') - 1;
        const dias = parseInt(tokens[diasIndex], 10);
        startDate = new Date(hoje);
        startDate.setDate(startDate.getDate() - (dias -1));
        endDate = new Date(hoje);
    } else if (tokens.includes('ontem')) {
        startDate = new Date(hoje);
        startDate.setDate(startDate.getDate() - 1);
        endDate = new Date(startDate);
    } else { 
        startDate = new Date(hoje);
        endDate = new Date(hoje);
    }
    
    return generateReport(userId, startDate, endDate);
}

async function generateReport(userId, startDate, endDate) {
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const recordsRef = db.collection(`artifacts/${appId}/users/${userId}/registros_ponto`);
    const querySnapshot = await recordsRef
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate)
        .orderBy('timestamp', 'asc')
        .get();
    
    const records = querySnapshot.docs.map(doc => doc.data());
    
    if (records.length === 0) {
        return 'Nenhum registo encontrado para o período solicitado.';
    }

    const dailyTotals = {};
    records.forEach(record => {
        const date = record.timestamp.toDate().toLocaleDateString('pt-BR', {timeZone: 'America/Sao_Paulo'});
        if (!dailyTotals[date]) {
            dailyTotals[date] = [];
        }
        dailyTotals[date].push(record);
    });

    let totalPeriodMinutes = 0;
    let reportLines = [`*Relatório de Ponto - ${startDate.toLocaleDateString('pt-BR')} a ${endDate.toLocaleDateString('pt-BR')}*\n`];

    const sortedDates = Object.keys(dailyTotals).sort((a, b) => {
        const [dayA, monthA, yearA] = a.split('/');
        const [dayB, monthB, yearB] = b.split('/');
        return new Date(`${yearA}-${monthA}-${dayA}`) - new Date(`${yearB}-${monthB}-${dayB}`);
    });

    sortedDates.forEach(date => {
        const dayRecords = dailyTotals[date];
        let dailyMinutes = 0;
        for (let i = 0; i < dayRecords.length; i += 2) {
            const entry = dayRecords[i];
            const exit = dayRecords[i + 1];
            if (entry && entry.type === 'entrada' && exit && exit.type === 'saída') {
                const diff = (exit.timestamp.toDate() - entry.timestamp.toDate()) / (1000 * 60);
                dailyMinutes += diff;
            }
        }
        if(dailyMinutes > 0){
             reportLines.push(`- ${date}: *${formatMinutes(dailyMinutes)}*`);
             totalPeriodMinutes += dailyMinutes;
        }
    });

    reportLines.push(`\n*Total no Período:* ${formatMinutes(totalPeriodMinutes)}`);
    return reportLines.join('\n');
}


async function generateMockData(userId) {
  const collectionRef = db.collection(`artifacts/${appId}/users/${userId}/registros_ponto`);
  const snapshot = await collectionRef.get();
  
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    let day = new Date();
    day.setDate(today.getDate() - i);
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    const entrada1 = new Date(day);
    entrada1.setHours(9, Math.floor(Math.random() * 10), 0, 0);
    await addRecord(userId, 'entrada', entrada1);

    const saida1 = new Date(day);
    saida1.setHours(12, 30 + Math.floor(Math.random() * 10), 0, 0);
    await addRecord(userId, 'saída', saida1);

    const entrada2 = new Date(day);
    entrada2.setHours(13, 30 + Math.floor(Math.random() * 10), 0, 0);
    await addRecord(userId, 'entrada', entrada2);

    const saida2 = new Date(day);
    saida2.setHours(18, Math.floor(Math.random() * 10), 0, 0);
    await addRecord(userId, 'saída', saida2);
  }
  return '✅ Dados fictícios gerados! Tente "relatório últimos 7 dias" agora.';
}

async function addRecord(userId, type, specificDate = null) {
  const record = {
    type: type,
    timestamp: specificDate ? specificDate : admin.firestore.FieldValue.serverTimestamp()
  };
  const collectionPath = `artifacts/${appId}/users/${userId}/registros_ponto`;
  await db.collection(collectionPath).add(record);
  console.log(`Registo de '${type}' guardado para o utilizador ${userId}`);
}


// --- Funções Auxiliares ---
function parseDate(dateStr) {
    const [day, month, year] = dateStr.split('/');
    return new Date(`${year}-${month}-${day}`);
}

function formatMinutes(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`;
}

async function sendReply(to, text) {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

  if (!apiUrl || !apiKey || !instanceName) {
    console.error('As variáveis de ambiente da Evolution API não estão configuradas!');
    return;
  }
  
  const sendMessageUrl = `${apiUrl}/message/sendText/${instanceName}`;
  const recipientNumber = to.split('@')[0];

  try {
    // CORREÇÃO APLICADA AQUI
    await axios.post(sendMessageUrl, {
      number: recipientNumber,
      options: { delay: 1200, presence: "composing" },
      text: text // Usar 'text' diretamente, e não 'textMessage'
    }, {
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' }
    });
    console.log(`Resposta enviada para ${to}`);
  } catch (error) {
     console.error('Erro detalhado da Evolution API:', JSON.stringify(error.response?.data, null, 2));
  }
}

// --- Inicia o Servidor ---
app.listen(PORT, () => {
  console.log(`Servidor a rodar na porta ${PORT}`);
});

