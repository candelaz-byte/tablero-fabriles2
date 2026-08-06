'use strict';
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'TablereFabrilesDH',
  description: 'Tablero Costos Fabriles Dos Hermanos',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: ['--harmony'],
  workingDirectory: __dirname,
  allowServiceLogon: true,
});

svc.on('install', () => {
  svc.start();
  console.log('Servicio instalado e iniciado.');
});

svc.on('alreadyinstalled', () => {
  console.log('Ya estaba instalado. Iniciando...');
  svc.start();
});

svc.install();
