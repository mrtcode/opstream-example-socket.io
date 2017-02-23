var OpStream = require('opstream');
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = 3000;

server.listen(port, function () {
  console.log('Server listening at port %d', port);
});

app.use(express.static(__dirname + '/public'));

io.on('connection', function (socket) {

  var opStream = new OpStream();

  socket.on('message', function (data) {
    opStream.recv(data);
  });

  opStream.send = function(data) {
    socket.emit('message', data);
  };

  opStream.onReadable = function () {
    var op;
    while (op = opStream.pop()) {
      console.log('client ' + socket.id + ' sent', op);
    }
  };

  var n = 1;

  setInterval( function() {
    opStream.push('packet'+n);
    n++;
  }, 1000);

});