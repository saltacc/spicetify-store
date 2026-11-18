// Adapted from SpotiKit 0.9.0 (NMWplays and contributors, AGPLv3). The player
// and event helpers derived from spicetify/cli retain the Spicetify contributors'
// LGPL v2.1 terms. Modified for store cleanup on 2026-11-17 and initial player
// state on 2026-11-18. See THIRD_PARTY_NOTICES.txt.
export function installPlayer({ api, SpotiKit, P, internal, own, lazyValue }) {
  function OneTime() {
    this.callbacks = [];
  }
  OneTime.prototype.on = function (callback) {
    if (!this.callbacks) {
      callback();
      return;
    }
    this.callbacks.push(callback);
  };
  OneTime.prototype.fire = function () {
    var callbacks = this.callbacks || [];
    this.callbacks = undefined;
    callbacks.forEach(function (callback) {
      try {
        callback();
      } catch (e) {
        internal.log.error("A api.Events listener threw", e);
      }
    });
  };
  api.Events = { webpackLoaded: new OneTime(), platformLoaded: new OneTime() };

  function player() {
    return P.PlayerAPI;
  }
  function playerState() {
    var p = player();
    return (p && p._state) || {};
  }

  // Spicetify starts listening after the native player has its first snapshot.
  // SpotiKit can already emit an empty state while that snapshot is being initialized.
  let lastPlayerUpdate, offState;
  let stopped = false;
  const hasSnapshot = () => player()?._state || SpotiKit.Player.state;
  function watchState() {
    if (!stopped) {
      offState = SpotiKit.Player.on("state", (state) => { lastPlayerUpdate = state; });
    }
  }
  if (hasSnapshot()) watchState();
  else internal.waitFor(() => stopped || hasSnapshot()).then(watchState);
  own(() => {
    stopped = true;
    offState?.();
  });

  let offProgress;
  function hookProgress() {
    if (offProgress) {
      return;
    }
    offProgress = SpotiKit.Player.on("progress", function (ms) {
      var event = new Event("onprogress");
      event.data = ms;
      api.Player.dispatchEvent(event);
    });
  }

  api.Player = {
    eventListeners: {},
    addEventListener: function (type, callback) {
      if (!(type in api.Player.eventListeners)) {
        api.Player.eventListeners[type] = [];
      }
      api.Player.eventListeners[type].push(callback);
      own(() => api.Player.removeEventListener(type, callback));
      if (type === "onprogress") {
        hookProgress();
      }
    },
    removeEventListener: function (type, callback) {
      var stack = api.Player.eventListeners[type];
      var at = stack ? stack.indexOf(callback) : -1;
      if (at >= 0) {
        stack.splice(at, 1);
        if (type === "onprogress" && !stack.length && offProgress) {
          offProgress();
          offProgress = undefined;
        }
      }
    },
    dispatchEvent: function (event) {
      var stack = (api.Player.eventListeners[event.type] || []).slice();
      for (var i = 0; i < stack.length; i++) {
        if (typeof stack[i] === "function") {
          try {
            stack[i](event);
          } catch (e) {
            internal.log.error("A api.Player '" + event.type + "' listener threw", e);
          }
        }
      }
      return !event.defaultPrevented;
    },
    get origin() {
      return player();
    },
    get data() {
      return lastPlayerUpdate === undefined ? SpotiKit.Player.state ?? undefined : lastPlayerUpdate;
    },
    seek: function (position) {
      var ms =
        !Number.isInteger(position) && position >= 0 && position <= 1
          ? Math.round(position * (playerState().duration || 0))
          : position;
      return player().seekTo(ms);
    },
    getProgress: function () {
      return SpotiKit.Player.position;
    },
    getProgressPercent: function () {
      return SpotiKit.Player.progress;
    },
    getDuration: function () {
      return SpotiKit.Player.duration;
    },
    setVolume: function (level) {
      return SpotiKit.Player.setVolume(level);
    },
    increaseVolume: function () {
      return SpotiKit.Player.volumeUp();
    },
    decreaseVolume: function () {
      return SpotiKit.Player.volumeDown();
    },
    getVolume: function () {
      return SpotiKit.Player.volume;
    },
    next: function () {
      return SpotiKit.Player.next();
    },
    back: function () {
      return SpotiKit.Player.previous();
    },
    togglePlay: function () {
      return SpotiKit.Player.toggle();
    },
    isPlaying: function () {
      return SpotiKit.Player.isPlaying;
    },
    toggleShuffle: function () {
      return SpotiKit.Player.setShuffle(!SpotiKit.Player.shuffle);
    },
    getShuffle: function () {
      return SpotiKit.Player.shuffle;
    },
    setShuffle: function (on) {
      return SpotiKit.Player.setShuffle(on);
    },
    toggleRepeat: function () {
      return player().setRepeat(((playerState().repeat || 0) + 1) % 3);
    },
    getRepeat: function () {
      return playerState().repeat || 0;
    },
    setRepeat: function (mode) {
      return player().setRepeat(mode);
    },
    getMute: function () {
      return SpotiKit.Player.muted;
    },
    toggleMute: function () {
      return SpotiKit.Player.setMuted(!SpotiKit.Player.muted);
    },
    setMute: function (muted) {
      return SpotiKit.Player.setMuted(!!muted);
    },
    formatTime: function (ms) {
      var seconds = Math.floor(ms / 1000);
      var minutes = Math.floor(seconds / 60);
      seconds -= minutes * 60;
      return minutes + ":" + (seconds > 9 ? "" : "0") + seconds;
    },
    getHeart: function () {
      return SpotiKit.Player.liked;
    },
    setHeart: function (liked) {
      return SpotiKit.Player.setLiked(!!liked);
    },
    toggleHeart: function () {
      return SpotiKit.Player.setLiked(!SpotiKit.Player.liked);
    },
    pause: function () {
      return SpotiKit.Player.pause();
    },
    play: function () {
      return SpotiKit.Player.play();
    },
    playUri: function (uri, context, options) {
      return player().play({ uri: uri }, context || {}, options || {});
    },
    skipBack: function (amount) {
      return player().seekBackward(amount === undefined ? 15000 : amount);
    },
    skipForward: function (amount) {
      return player().seekForward(amount === undefined ? 15000 : amount);
    },
  };

  function dispatch(type, value) {
    var event = new Event(type);
    event.data = value;
    api.Player.dispatchEvent(event);
  }
  own(
    SpotiKit.Player.on("track", function (state) {
      dispatch("songchange", state);
    }),
  );
  own(
    SpotiKit.Player.on("playpause", function (state) {
      dispatch("onplaypause", state);
    }),
  );
  own(
    SpotiKit.Navigation.on("change", function (path) {
      dispatch("appchange", { path: path, container: document.querySelector(".main-view-container") });
    }),
  );

  api.Platform = P;
  lazyValue("_platform", () => internal.findPlatform?.());
}
