(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.OpStream = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
function isNumber(n) {
  return typeof n === 'number' && n % 1 === 0;
}

/*
 * Receiver stream
 */
var InStream = function (options) {
  options = options || {};
  this.maxLen = options.maxLen || 20; //how many packets can be buffered before stopping acknowledging new packets
  this.ops = [];
  this.seq = 0;
  this.drained = true;
  this._send = function (op) {
  };
};

InStream.prototype.isReadable = function () {
  return this.ops.length && this.ops[0].seq == (this.seq + 1);
};

InStream.prototype.pop = function () {

  if (!this.isReadable()) {
    return null;
  }

  var op = this.ops.shift();

  this.seq++;

  this._send({ack: this.seq});

  if (!this.isReadable()) {
    this.drained = true;
  }

  return op.data;
};

InStream.prototype.insert = function (op) {

  if (this.ops.length >= this.maxLen) {
    return; //packet buffer lenght exceeded, dropping packets
  }

  if (op.seq <= this.seq) {
    //already processed this op, acknowledge with the last seq we have have
    this._send({ack: this.seq});
    return;
  }

  if ((op.seq - this.seq - 1) > this.maxLen) {
    return; //if op.seq is i.e. 1000000, then algorithm will block itself because of this.maxLen
  }

  var pos = 0;

  for (var i = 0; i < this.ops.length; i++) {
    var opi = this.ops[i];
    if (opi.seq == op.seq) {
      return; //drop, this packet already is in ops - waiting for pop OR previous packets
    } else if (opi.seq < op.seq) {
      pos = i + 1; //most of the time it will be the end of array
    }
  }

  this.ops.splice(pos, 0, op);

  if (this.drained && this.onReadable && this.isReadable()) {
    this.drained = false;
    setTimeout(this.onReadable, 0);
  }
};

/*
 * Sender stream
 */
var OutStream = function (options) {
  options = options || {};
  this.retryTimeout = options.retryTimeout || 10000;
  this.maxNotAck = options.maxNotAck || 10; //how many unacknowledged packets can be in fly
  this.ops = [];
  this.seq = 0;
  this.sentSeq = 0; //the last packet which was sent, but still not acknowledged
  this.lastSend = 0;
  this._send = function (op) {
  };
};

OutStream.prototype.triggerSend = function () {

  if (this.isWaitingAck() && (Date.now() - this.lastSend) > this.retryTimeout) {
    this.sentSeq = this.ops[0].seq - 1;
  }

  if (this.ops.length) {
    if (this.sentSeq < (this.ops[0].seq + this.maxNotAck)) {
      for (var i = 0; i < this.ops.length; i++) {
        var opi = this.ops[i];
        if (opi.seq > this.sentSeq) {
          this._send(opi);
          this.sentSeq = opi.seq;
          this.lastSend = Date.now();
        }

        if ((i + 1) >= this.maxNotAck) {
          break;
        }
      }
    }
  }
};

OutStream.prototype.isWaitingAck = function () {
  return this.ops.length && this.sentSeq >= this.ops[0].seq; //it can be that there are ops, but we still haven't sent them, so trigger should them first
};

OutStream.prototype.retry = function () {
  if (this.ops.length) {
    this.sentSeq = this.ops[0].seq - 1;
    this.triggerSend();
  }
};

OutStream.prototype.push = function (data) {
  this.seq++;

  var op = {
    seq: this.seq,
    data: data
  };
  this.ops.push(op);
  this.triggerSend();
};

//find index of the acknowledged packet and remove every packet below
OutStream.prototype.acknowledge = function (seq) {
  var n = 0;
  for (var i = 0; i < this.ops.length; i++) {
    var opi = this.ops[i];
    if (opi.seq <= seq) {
      n = i + 1;
    }
  }

  if (n) {
    this.ops.splice(0, n);
    this.triggerSend();
  }
};

/*
 * OpStream
 */

var OpStream = function (options) {
  var opStream = this;

  options = options || {};

  this.pingIntervalMs = options.pingIntervalMs || 5000;
  this.pingTimeoutMs = options.pingTimeoutMs || 3000;

  this.inStream = new InStream({
    maxLen: options.inMaxLen
  });

  this.outStream = new OutStream({
    retryTimeout: options.outRetryTimeout,
    maxNotAck: options.outMaxNotAck
  });

  this.inStream._send = this._send.bind(this);
  this.outStream._send = this._send.bind(this);

  this.inStream.onReadable = function () {
    if (opStream.onReadable) opStream.onReadable();
  };

  this.onReadable = null;
  this.onOnline = null;
  this.onOffline = null;

  this.lastPing = 0;

  this.connectionStatus = 'online';
  this.paused = false;

  this.timerInterval = null;
  this.pingTimeout = null;

  this.initTimer();
};

OpStream.prototype.initTimer = function () {
  var opStream = this;
  this.timerInterval = setInterval(function () {
    opStream.outStream.triggerSend();
    opStream.triggerPing();
  }, 300);
};

OpStream.prototype.destroy = function() {
  clearInterval(this.timerInterval);
  if (this.pingTimeout) {
    clearTimeout(this.pingTimeout);
    this.pingTimeout = null;
  }
  this.onReadable = null;
  this.onOnline = null;
  this.onOffline = null;
};

OpStream.prototype.setPaused = function (pause) {
  if (pause) {
    this.paused = true;
  } else {
    if (this.paused) {
      this.paused = false;
      this.outStream.triggerSend();
    }
  }
};

OpStream.prototype.pingTimeouted = function () {
  if (this.connectionStatus == 'online') {
    this.connectionStatus = 'offline';
    if (this.onOffline) {
      this.onOffline();
    }
  }
};

OpStream.prototype.triggerPing = function () {
  if ((Date.now() - this.lastPing) > this.pingIntervalMs) {
    this._send({ping: Date.now()});
    this.pingTimeout = setTimeout(this.pingTimeouted.bind(this), this.pingTimeoutMs);
    this.lastPing = Date.now();
  }
};

OpStream.prototype.ponged = function (packet) {
  var time = Date.now() - packet.pong;
  if (this.pingTimeout) {
    clearTimeout(this.pingTimeout);
    this.pingTimeout = null;
  }
  if (this.connectionStatus == 'offline') {
    this.connectionStatus = 'online';
    if (this.onOnline) {
      this.onOnline();
    }
  }
};

OpStream.prototype.push = function (data) {
  this.outStream.push(data);
};

OpStream.prototype.pop = function () {
  return this.inStream.pop();
};

OpStream.prototype._send = function (op) {
  if (!this.paused && this.send) {
    this.send(op);
  }
};

OpStream.prototype.recv = function (packet) {
  if (packet.seq) {
    if (isNumber(packet.seq)) {
      this.inStream.insert(packet);
    }
  } else if (packet.ack) {
    if (isNumber(packet.ack)) {
      this.outStream.acknowledge(packet.ack);
    }
  } else if (packet.ping) {
    if (isNumber(packet.ping)) {
      this._send({pong: packet.ping});
    }
  } else if (packet.pong) {
    if (isNumber(packet.pong)) {
      this.ponged(packet);
    }
  }
};

module.exports = OpStream;
},{}]},{},[1])(1)
});