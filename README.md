
# OpStream + Socket.io example

OpStream wraps Socket.io and guarantees sequence for packets no matter which transport layer is used.


```
git clone https://github.com/mrtcode/opstream-example-socket.io.git
cd opstream-example-socket.io
npm install
npm start
```

Open http://localhost:3000/


```js
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
```

