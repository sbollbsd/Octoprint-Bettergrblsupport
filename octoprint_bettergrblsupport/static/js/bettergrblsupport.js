/*
 * View model for OctoPrint-Bettergrblsupport
 *
 * Author: Shell M. Shrader
 * License: Apache 2.0
 */
$(function() {
    function BettergrblsupportViewModel(parameters) {
        var self = this;

        self.sessionId = guid();

        self.loginState = parameters[0];
        self.settings = parameters[1];
        self.access = parameters[2];

        var $body = $('body');
        var framingPanel = $('#framing_panel');
        var controlPanel = $('#control_panel');
        var overridesPanel = $('#overrides_panel');

        self.webcamDisableTimeout = undefined;
        self.webcamLoaded = ko.observable(false);
        self.webcamMjpgEnabled = ko.observable(false);
        self.webcamHlsEnabled = ko.observable(false);
        self.webcamError = ko.observable(false);

        // assign the injected parameters, e.g.:
        self.settings = parameters[0];
        self.loginState = parameters[1];

        self.origin_axes = ko.observableArray(["Z", "Y", "X", "XY", "ALL"]);
        self.origin_axis = ko.observable("XY");

        self.operator = ko.observable("=");
        self.distances = ko.observableArray([.1, 1, 5, 10, 50, 100]);
        self.distance = ko.observable(100);

        self.is_printing = ko.observable(false);
        self.is_operational = ko.observable(false);
        self.isLoading = ko.observable(undefined);

        self.mode = ko.observable("N/A");
        self.state = ko.observable("N/A");
        self.xPos = ko.observable("N/A");
        self.yPos = ko.observable("N/A");
        self.zPos = ko.observable("N/A");
        self.power = ko.observable("N/A");
        self.speed = ko.observable("N/A");

        self.feedRate = ko.observable(undefined);
        self.plungeRate = ko.observable(undefined);
        self.powerRate = ko.observable(undefined);

        self.controls = ko.observableArray([]);

        tab = document.getElementById("tab_plugin_bettergrblsupport_link");
        tab.innerHTML = tab.innerHTML.replace("Better Grbl Support", "Grbl Control");

        self._disableWebcam = function() {
            // only disable webcam stream if tab is out of focus for more than 5s, otherwise we might cause
            // more load by the constant connection creation than by the actual webcam stream

            // safari bug doesn't release the mjpeg stream, so we just disable this for safari.
            if (OctoPrint.coreui.browser.safari) {
                return;
            }

            var timeout = self.settings.webcam_streamTimeout() || 5;
            self.webcamDisableTimeout = setTimeout(function() {
                log.debug("Unloading webcam stream");
                $("#webcam_image").attr("src", "");
                self.webcamLoaded(false);
            }, timeout * 1000);
        };

        self._enableWebcam = function() {
            if (OctoPrint.coreui.selectedTab != undefined &&
                (OctoPrint.coreui.selectedTab != "#tab_plugin_bettergrblsupport" ||
                    !OctoPrint.coreui.browserTabVisible)
            ) {
                return;
            }

            if (self.webcamDisableTimeout != undefined) {
                clearTimeout(self.webcamDisableTimeout);
            }

            // IF disabled then we dont need to do anything
            if (self.settings.webcam_webcamEnabled() == false) {
                return;
            }

            // Determine stream type and switch to corresponding webcam.
            var streamType = determineWebcamStreamType(self.settings.webcam_streamUrl());
            if (streamType == "mjpg") {
                self._switchToMjpgWebcam();
            } else if (streamType == "hls") {
                self._switchToHlsWebcam();
            } else {
                throw "Unknown stream type " + streamType;
            }
        };

        self.onWebcamLoaded = function() {
            if (self.webcamLoaded()) return;

            log.debug("Webcam stream loaded");
            self.webcamLoaded(true);
            self.webcamError(false);
        };

        self.onWebcamErrored = function() {
            log.debug("Webcam stream failed to load/disabled");
            self.webcamLoaded(false);
            self.webcamError(true);
        };

        self.onTabChange = function(current, previous) {
            if (current == "#tab_plugin_bettergrblsupport") {
                self._enableWebcam();
            } else if (previous == "#tab_plugin_bettergrblsupport") {
                self._disableWebcam();
            }
        };

        self.onBrowserTabVisibilityChange = function(status) {
            if (status) {
                self._enableWebcam();
            } else {
                self._disableWebcam();
            }
        };

        self.webcamRatioClass = ko.pureComputed(function() {
            if (self.settings.webcam_streamRatio() == "4:3") {
                return "ratio43";
            } else {
                return "ratio169";
            }
        });

        self._switchToMjpgWebcam = function() {
            var webcamImage = $("#webcam_image");
            var currentSrc = webcamImage.attr("src");

            // safari bug doesn't release the mjpeg stream, so we just set it up the once
            if (OctoPrint.coreui.browser.safari && currentSrc != undefined) {
                return;
            }

            var newSrc = self.settings.webcam_streamUrl();
            if (currentSrc != newSrc) {
                if (self.settings.webcam_cacheBuster()) {
                    if (newSrc.lastIndexOf("?") > -1) {
                        newSrc += "&";
                    } else {
                        newSrc += "?";
                    }
                    newSrc += new Date().getTime();
                }

                self.webcamLoaded(false);
                self.webcamError(false);
                webcamImage.attr("src", newSrc);

                self.webcamHlsEnabled(false);
                self.webcamMjpgEnabled(true);
            }
        };

        self._switchToHlsWebcam = function() {
            var video = document.getElementById("webcam_hls");

            // Check for native playback options: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/canPlayType
            if (
                video != null &&
                typeof video.canPlayType != undefined &&
                video.canPlayType("application/vnd.apple.mpegurl") == "probably"
            ) {
                video.src = self.settings.webcam_streamUrl();
            } else if (Hls.isSupported()) {
                var hls = new Hls();
                hls.loadSource(self.settings.webcam_streamUrl());
                hls.attachMedia(video);
            }

            self.webcamMjpgEnabled(false);
            self.webcamHlsEnabled(true);
        };

        self.onAllBound = function(allViewModels) {
            self._enableWebcam();
        };


        self.toggleWeak = function() {
            $.ajax({
                url: API_BASEURL + "plugin/bettergrblsupport",
                type: "POST",
                dataType: "json",
                data: JSON.stringify({
                    command: "toggleWeak"
                }),
                contentType: "application/json; charset=UTF-8",
                success: function(data) {
                    var btn = document.getElementById("grblLaserButton");
                    btn.innerHTML = btn.innerHTML.replace(btn.innerText, data["res"]);
                },
                error: function(data, status) {
                    new PNotify({
                        title: "Laser action failed!",
                        text: data.responseText,
                        hide: true,
                        buttons: {
                            sticker: false,
                            closer: true
                        },
                        type: "error"
                    });
                }
            });
        };

        self.distanceClicked = function(distance) {
            var operator;
            if (self.operator() == "+") {
                operator = 1;
            } else {
                if (self.operator() == "-") {
                    operator = -1;
                } else {
                    operator = 0;
                }
            }

            if (operator != 0) {
                self.distance(parseFloat(self.distance()) + (parseFloat(distance) * operator));
            } else {
                self.distance(parseFloat(distance));
            }
        };

        self.operatorClicked = function() {
            if (self.operator() == "+") {
                self.operator("-");
            } else {
                if (self.operator() == "-") {
                    self.operator("=");
                } else {
                    if (self.operator() == "=") {
                        self.operator("+");
                    }
                }
            }
        };

        self.moveHead = function(direction) {
            $.ajax({
                url: API_BASEURL + "plugin/bettergrblsupport",
                type: "POST",
                dataType: "json",
                data: JSON.stringify({
                    command: "move",
                    sessionId: self.sessionId,
                    direction: direction,
                    distance: self.distance(),
                    axis: self.origin_axis()
                }),
                contentType: "application/json; charset=UTF-8",
                success: function(data) {
                    if (data != undefined && data["res"] != undefined && data["res"].length > 0) {
                        new PNotify({
                            title: "Unable to Move!",
                            text: data["res"],
                            hide: true,
                            buttons: {
                                sticker: false,
                                closer: true
                            },
                            type: "error"
                        });
                    }
                },
                error: function(data, status) {
                    new PNotify({
                        title: "Move Head failed!",
                        text: data.responseText,
                        hide: true,
                        buttons: {
                            sticker: false,
                            closer: true
                        },
                        type: "error"
                    });
                }
            });
        };

        self.sendCommand = function(command) {
            if (command == "unlock") {
                new PNotify({
                    title: "Unlock Machine",
                    text: "GRBL prefers you re-home your machine rather than unlock it.  Are you sure you want to unlock your machine?",
                    type: "notice",
                    hide: false,
                    animation: "fade",
                    animateSpeed: "slow",
                    sticker: false,
                    closer: true,
                    confirm: {
                        confirm: true,
                        buttons: [{
                                text: "CONFIRM",
                                click: function(notice) {
                                    $.ajax({
                                        url: API_BASEURL + "plugin/bettergrblsupport",
                                        type: "POST",
                                        dataType: "json",
                                        data: JSON.stringify({
                                            command: command
                                        }),
                                        contentType: "application/json; charset=UTF-8",
                                        error: function(data, status) {
                                            new PNotify({
                                                title: "Unable to unlock machine!",
                                                text: data.responseText,
                                                hide: true,
                                                buttons: {
                                                    sticker: false,
                                                    closer: true
                                                },
                                                type: "error"
                                            });
                                        }
                                    });
                                    notice.remove();
                                }
                            },
                            {
                                text: "CANCEL",
                                click: function(notice) {
                                    notice.remove();
                                }
                            },
                        ]
                    },
                });
                return;
            }

            $.ajax({
                url: API_BASEURL + "plugin/bettergrblsupport",
                type: "POST",
                dataType: "json",
                data: JSON.stringify({
                    command: command,
                    origin_axis: self.origin_axis(),
                    feed_rate: self.feedRate(),
                    plunge_rate: self.plungeRate(),
                    power_rate: self.powerRate()
                }),
                contentType: "application/json; charset=UTF-8",
                success: function(data) {
                    if (command == "feedRate") self.feedRate(undefined);
                    if (command == "plungeRate") self.plungeRate(undefined);
                    if (command == "powerRate") self.powerRate(undefined);
                },
                error: function(data, status) {
                    new PNotify({
                        title: "Unable to send command: " + command,
                        text: data.responseText,
                        hide: true,
                        buttons: {
                            sticker: false,
                            closer: true
                        },
                        type: "error"
                    });
                }
            });
        };

        self.onBeforeBinding = function() {
            self.is_printing(self.settings.settings.plugins.bettergrblsupport.is_printing());
            self.is_operational(self.settings.settings.plugins.bettergrblsupport.is_operational());

            self.distance(self.settings.settings.plugins.bettergrblsupport.control_distance());
            self.settings.settings.plugins.bettergrblsupport.control_distance.subscribe(function(newValue) {
              self.distance(newValue);
            });
        };

        self.onAllBound = function (allViewModels) {
          OctoPrint.control.getCustomControls().done(function (response) {
            self.controls(self._processControls(response.controls));
          });
        };

        self.fromCurrentData = function(data) {
            self._processStateData(data.state);
        };

        self.fromHistoryData = function(data) {
            self._processStateData(data.state);
        };

        self._processStateData = function(data) {
            self.is_printing(data.flags.printing);
            self.is_operational(data.flags.operational);
            self.isLoading(data.flags.loading);
        };


        self.onDataUpdaterPluginMessage = function(plugin, data) {
            if (plugin == 'bettergrblsupport' && data.type == 'grbl_state') {
                if (data.mode != undefined) self.mode(data.mode);
                if (data.state != undefined) self.state(data.state);
                if (data.x != undefined) self.xPos(Number.parseFloat(data.x).toFixed(2));
                if (data.y != undefined) self.yPos(Number.parseFloat(data.y).toFixed(2));
                if (data.z != undefined) self.zPos(Number.parseFloat(data.z).toFixed(2));
                if (data.speed != undefined) self.speed(data.speed);

                if (data.state != "Run" && data.power != "N/A" && !self.is_printing()) {
                    var btn = document.getElementById("grblLaserButton");

                    if (btn != null) {
                        if (data.power == "0" && self.power() != "0") {
                            btn.innerHTML = btn.innerHTML.replace(btn.innerText, "Weak Laser");
                        } else {
                            if (self.power() == "0" && data.power != "0") {
                                btn.innerHTML = btn.innerHTML.replace(btn.innerText, "Laser Off");
                            }
                        }
                    }
                }

                if (data.power != undefined) self.power(data.power);
                // console.log("mode=" + data.mode + " state=" + data.state + " x=" + data.x + " y=" + data.y + " z=" + data.z + " power=" + data.power + " speed=" + data.speed);
                return
            }

            if (plugin == 'bettergrblsupport' && data.type == 'simple_notify') {
              if (data.sessionId == undefined || data.sessionId == self.sessionId) {
                new PNotify({
                    title: data.title,
                    text: data.text,
                    hide: data.hide,
                    animation: "fade",
                    animateSpeed: "slow",
                    mouseReset: true,
                    delay: data.delay,
                    buttons: {
                        sticker: true,
                        closer: true
                    },
                    type: data.notify_type,
                });
              }
              return
            }

            if (plugin == 'bettergrblsupport' && data.type == 'restart_required') {
                new PNotify({
                    title: "Restart Required",
                    text: "Octoprint may need to be restarted for your changes to take full effect.",
                    hide: false,
                    animation: "fade",
                    animateSpeed: "slow",
                    mouseReset: true,
                    buttons: {
                        sticker: true,
                        closer: true
                    },
                    type: "notice"
                });
                return
            }

            if (plugin == 'bettergrblsupport' && data.type == 'send_notification') {
                $.ajax({
                    url: API_BASEURL + "plugin/action_command_notification",
                    type: "POST",
                    dataType: "json",
                    data: JSON.stringify({
                        command: "add",
                        message: data.message
                    }),
                    contentType: "application/json; charset=UTF-8",
                    error: function(data, status) {
                        new PNotify({
                            title: "Unable to add notification",
                            text: data.responseText,
                            hide: true,
                            buttons: {
                                sticker: false,
                                closer: true
                            },
                            type: "error"
                        });
                    }
                });
            }

            if (plugin == 'bettergrblsupport' && data.type == 'xy_probe') {
                if (data.sessionId != undefined && data.sessionId == self.sessionId) {
                  var text = "";
                  var confirmActions = self.settings.settings.plugins.bettergrblsupport.zProbeConfirmActions();

                  if (!confirmActions) {
                    OctoPrint.control.sendGcode(data.gcode);
                    return
                  }

                  text = "Select <B>PROCEED</B> to initiate an X/Y Probe for the [" + data.axis + "] axis.  Please ensure the probe is positioned properly before proceeding.";

                  new PNotify({
                      title: "X/Y Probe",
                      text: text,
                      type: "notice",
                      hide: false,
                      animation: "fade",
                      animateSpeed: "slow",
                      sticker: false,
                      closer: true,
                      confirm: {
                          confirm: true,
                          buttons: [{
                                  text: "PROCEED",
                                  click: function(notice) {
                                    OctoPrint.control.sendGcode(data.gcode);
                                    notice.remove();
                                  }
                              },
                              {
                                  text: "CANCEL",
                                  click: function(notice) {
                                      // we need to inform the plugin we bailed
                                      $.ajax({
                                          url: API_BASEURL + "plugin/bettergrblsupport",
                                          type: "POST",
                                          dataType: "json",
                                          data: JSON.stringify({
                                              command: "cancelProbe"
                                          }),
                                          contentType: "application/json; charset=UTF-8",
                                          error: function(data, status) {
                                              new PNotify({
                                                  title: "Unable to cancel Multipoint Z-Probe",
                                                  text: data.responseText,
                                                  hide: true,
                                                  buttons: {
                                                      sticker: false,
                                                      closer: true
                                                  },
                                                  type: "error"
                                              });
                                          }
                                      });
                                      notice.remove();
                                  }
                              },
                          ]
                      },
                  });
                }
            }

            if (plugin == 'bettergrblsupport' && data.type == 'simple_zprobe') {
                if (data.sessionId != undefined && data.sessionId == self.sessionId) {
                  var text = "";
                  var confirmActions = self.settings.settings.plugins.bettergrblsupport.zProbeConfirmActions();

                  if (!confirmActions) {
                    OctoPrint.control.sendGcode(data.gcode);
                    return
                  }

                  text = "Select <B>PROCEED</B> to initiate Single Point Z-Probe once the machine is at the desired location, and you are ready to continue.";

                  new PNotify({
                      title: "Single Point Z-Probe",
                      text: text,
                      type: "notice",
                      hide: false,
                      animation: "fade",
                      animateSpeed: "slow",
                      sticker: false,
                      closer: true,
                      confirm: {
                          confirm: true,
                          buttons: [{
                                  text: "PROCEED",
                                  click: function(notice) {
                                    OctoPrint.control.sendGcode(data.gcode);
                                    notice.remove();
                                  }
                              },
                              {
                                  text: "CANCEL",
                                  click: function(notice) {
                                      // we need to inform the plugin we bailed
                                      $.ajax({
                                          url: API_BASEURL + "plugin/bettergrblsupport",
                                          type: "POST",
                                          dataType: "json",
                                          data: JSON.stringify({
                                              command: "cancelProbe"
                                          }),
                                          contentType: "application/json; charset=UTF-8",
                                          error: function(data, status) {
                                              new PNotify({
                                                  title: "Unable to cancel Multipoint Z-Probe",
                                                  text: data.responseText,
                                                  hide: true,
                                                  buttons: {
                                                      sticker: false,
                                                      closer: true
                                                  },
                                                  type: "error"
                                              });
                                          }
                                      });
                                      notice.remove();
                                  }
                              },
                          ]
                      },
                  });
                }
            }

            if (plugin == 'bettergrblsupport' && data.type == 'multipoint_zprobe') {
                if (data.sessionId != undefined && data.sessionId == self.sessionId) {
                  var instruction = data.instruction;
                  var text = "";
                  var confirmActions = self.settings.settings.plugins.bettergrblsupport.zProbeConfirmActions();

                  if (!confirmActions && instruction.action == "move") {
                    OctoPrint.control.sendGcode(instruction.gcode);
                    OctoPrint.control.sendGcode("BGS_MULTIPOINT_ZPROBE_MOVE");
                    return
                  }

                  if (instruction.action == "probe") {
                      text = "Select <B>PROCEED</B> to initiate Z-Probe once the machine has reached the [<B>" + instruction.location + "</B>] location, and you are ready to continue.";
                  } else {
                      text = "Your machine is ready to move to the [<B>" + instruction.location + "</B>] location.  Select <B>PROCEED</B> when you are ready to continue.";
                  }

                  new PNotify({
                      title: "Multipoint Z-Probe",
                      text: text,
                      type: "notice",
                      hide: false,
                      animation: "fade",
                      animateSpeed: "slow",
                      sticker: false,
                      closer: true,
                      confirm: {
                          confirm: true,
                          buttons: [{
                                  text: "PROCEED",
                                  click: function(notice) {
                                    OctoPrint.control.sendGcode(instruction.gcode);
                                      if (instruction.action == "move") {
                                        OctoPrint.control.sendGcode("BGS_MULTIPOINT_ZPROBE_MOVE");
                                      }
                                      notice.remove();
                                  }
                              },
                              {
                                  text: "CANCEL",
                                  click: function(notice) {
                                      // we need to inform the plugin we bailed
                                      $.ajax({
                                          url: API_BASEURL + "plugin/bettergrblsupport",
                                          type: "POST",
                                          dataType: "json",
                                          data: JSON.stringify({
                                              command: "cancelProbe"
                                          }),
                                          contentType: "application/json; charset=UTF-8",
                                          error: function(data, status) {
                                              new PNotify({
                                                  title: "Unable to cancel Multipoint Z-Probe",
                                                  text: data.responseText,
                                                  hide: true,
                                                  buttons: {
                                                      sticker: false,
                                                      closer: true
                                                  },
                                                  type: "error"
                                              });
                                          }
                                      });
                                      notice.remove();
                                  }
                              },
                          ]
                      },
                  });
                }
            }
        }

        self.modeClick = function() {
          if (self.is_operational() && !self.is_printing()) {
            if (self.mode() == "WPos") {
              OctoPrint.control.sendGcode("$10=1");
            } else {
              OctoPrint.control.sendGcode("$10=0");
            }
            OctoPrint.control.sendGcode("?");
          }
        }

        self.fsClick = function() {
            $body.toggleClass('inlineFullscreen');
            $container.toggleClass("inline fullscreen");
            // streamImg.classList.toggle("fullscreen");

            var progressBar = document.getElementById("state");

            if (progressBar.style.visibility == "" || progressBar.style.visibility == "visible") {
                progressBar.style.visibility = "hidden";
            } else {
                progressBar.style.visibility = "visible";
            }

            if (framingPanel.is(':visible')) {
                framingPanel.hide();
            } else {
                framingPanel.show();
            }

            if (controlPanel.is(':visible')) {
                controlPanel.hide();
            } else {
                controlPanel.show();
            }

            if (overridesPanel.is(':visible')) {
                overridesPanel.hide();
            } else {
                overridesPanel.show();
            }

            $('#sidebar_plugin_bettergrblsupport_wrapper').toggle();
            $('#sidebar_plugin_action_command_notification_wrapper').toggle();
        }


        self.feedRateResetter = ko.observable();
        self.resetFeedRateDisplay = function() {
            self.cancelFeedRateDisplayReset();
            self.feedRateResetter(
                setTimeout(function() {
                    self.feedRate(undefined);
                    self.feedRateResetter(undefined);
                }, 5000)
            );
        };
        self.cancelFeedRateDisplayReset = function() {
            var resetter = self.feedRateResetter();
            if (resetter) {
                clearTimeout(resetter);
                self.feedRateResetter(undefined);
            }
        };

        self.plungeRateResetter = ko.observable();
        self.resetPlungeRateDisplay = function() {
            self.cancelPlungeRateDisplayReset();
            self.plungeRateResetter(
                setTimeout(function() {
                    self.plungeRate(undefined);
                    self.plungeRateResetter(undefined);
                }, 5000)
            );
        };
        self.cancelPlungeRateDisplayReset = function() {
            var resetter = self.plungeRateResetter();
            if (resetter) {
                clearTimeout(resetter);
                self.plungeRateResetter(undefined);
            }
        };

        self.powerRateResetter = ko.observable();
        self.resetPowerRateDisplay = function() {
            self.cancelPowerRateDisplayReset();
            self.powerRateResetter(
                setTimeout(function() {
                    self.powerRate(undefined);
                    self.powerRateResetter(undefined);
                }, 5000)
            );
        };
        self.cancelPowerRateDisplayReset = function() {
            var resetter = self.powerRateResetter();
            if (resetter) {
                clearTimeout(resetter);
                self.powerRateResetter(undefined);
            }
        };



        self._processControls = function (controls) {
            for (var i = 0; i < controls.length; i++) {
                controls[i] = self._processControl(controls[i]);
            }
            return controls;
        };

        self._processControl = function (control) {
            if (control.hasOwnProperty("processed") && control.processed) {
                return control;
            }

            if (
                control.hasOwnProperty("template") &&
                control.hasOwnProperty("key") &&
                control.hasOwnProperty("template_key") &&
                !control.hasOwnProperty("output")
            ) {
                control.output = ko.observable(control.default || "");
                if (!self.feedbackControlLookup.hasOwnProperty(control.key)) {
                    self.feedbackControlLookup[control.key] = {};
                }
                self.feedbackControlLookup[control.key][control.template_key] =
                    control.output;
            }

            if (control.hasOwnProperty("children")) {
                control.children = ko.observableArray(
                    self._processControls(control.children)
                );
                if (
                    !control.hasOwnProperty("layout") ||
                    !(
                        control.layout == "vertical" ||
                        control.layout == "horizontal" ||
                        control.layout == "horizontal_grid"
                    )
                ) {
                    control.layout = "vertical";
                }

                if (!control.hasOwnProperty("collapsed")) {
                    control.collapsed = false;
                }
            }

            if (control.hasOwnProperty("input")) {
                var attributeToInt = function (obj, key, def) {
                    if (obj.hasOwnProperty(key)) {
                        var val = obj[key];
                        if (_.isNumber(val)) {
                            return val;
                        }

                        var parsedVal = parseInt(val);
                        if (!isNaN(parsedVal)) {
                            return parsedVal;
                        }
                    }
                    return def;
                };

                _.each(control.input, function (element) {
                    if (element.hasOwnProperty("slider") && _.isObject(element.slider)) {
                        element.slider["min"] = attributeToInt(element.slider, "min", 0);
                        element.slider["max"] = attributeToInt(
                            element.slider,
                            "max",
                            255
                        );

                        // try defaultValue, default to min
                        var defaultValue = attributeToInt(
                            element,
                            "default",
                            element.slider.min
                        );

                        // if default value is not within range of min and max, correct that
                        if (
                            !_.inRange(
                                defaultValue,
                                element.slider.min,
                                element.slider.max
                            )
                        ) {
                            // use bound closer to configured default value
                            defaultValue =
                                defaultValue < element.slider.min
                                    ? element.slider.min
                                    : element.slider.max;
                        }

                        element.value = ko.observable(defaultValue);
                    } else {
                        element.slider = false;
                        element.value = ko.observable(
                            element.hasOwnProperty("default")
                                ? element["default"]
                                : undefined
                        );
                    }
                });
            }

            if (control.hasOwnProperty("javascript")) {
                var js = control.javascript;

                // if js is a function everything's fine already, but if it's a string we need to eval that first
                if (!_.isFunction(js)) {
                    control.javascript = function (data) {
                        eval(js);
                    };
                }
            }

            if (control.hasOwnProperty("enabled")) {
                var enabled = control.enabled;

                // if js is a function everything's fine already, but if it's a string we need to eval that first
                if (!_.isFunction(enabled)) {
                    control.enabled = function (data) {
                        return eval(enabled);
                    };
                }
            }

            if (!control.hasOwnProperty("additionalClasses")) {
                control.additionalClasses = "";
            }

            control.processed = true;
            return control;
        };


        self.isCustomEnabled = function (data) {
            if (data.hasOwnProperty("enabled")) {
                return data.enabled(data);
            } else {
                return (
                    self.loginState.hasPermission(self.access.permissions.CONTROL) &&
                    self.is_operational()
                );
            }
        };

        self.clickCustom = function (data) {
            var callback;
            if (data.hasOwnProperty("javascript")) {
                callback = data.javascript;
            } else {
                callback = self.sendCustomCommand;
            }

            if (data.confirm) {
                showConfirmationDialog({
                    message: data.confirm,
                    onproceed: function (e) {
                        callback(data);
                    }
                });
            } else {
                callback(data);
            }
        };

        self.sendCustomCommand = function (command) {
            if (!command) return;

            var parameters = {};
            if (command.hasOwnProperty("input")) {
                _.each(command.input, function (input) {
                    if (
                        !input.hasOwnProperty("parameter") ||
                        !input.hasOwnProperty("value")
                    ) {
                        return;
                    }

                    parameters[input.parameter] = input.value();
                });
            }

            if (command.hasOwnProperty("command") || command.hasOwnProperty("commands")) {
                var commands = command.commands || [command.command];
                OctoPrint.control.sendGcodeWithParameters(commands, parameters);
            } else if (command.hasOwnProperty("script")) {
                var script = command.script;
                var context = command.context || {};
                OctoPrint.control.sendGcodeScriptWithParameters(
                    script,
                    context,
                    parameters
                );
            }
        };


        self.displayMode = function (customControl) {
            if (customControl.hasOwnProperty("children")) {
                if (customControl.name) {
                    return "customControls_containerTemplate_collapsable";
                } else {
                    return "customControls_containerTemplate_nameless";
                }
            } else {
                return "customControls_controlTemplate";
            }
        };

        self.rowCss = function (customControl) {
            var span = "span2";
            var offset = "";
            if (customControl.hasOwnProperty("width")) {
                span = "span" + customControl.width;
            }
            if (customControl.hasOwnProperty("offset")) {
                offset = "offset" + customControl.offset;
            }
            return span + " " + offset;
        };
    }

    // cute little hack for removing "Print" from the start button
    $('#job_print')[0].innerHTML = "<i class=\"fas\" data-bind=\"css: {'fa-print': !isPaused(), 'fa-undo': isPaused()}\"></i> <span data-bind=\"text: (isPaused() ? 'Restart' : 'Start')\">Start</span>"

    // cute hack for changing printer to machine for the action notify sidebar plugin
    var x = document.getElementById("sidebar_plugin_action_command_notification_wrapper");
    if (x != undefined) {
        x.firstElementChild.outerHTML = x.firstElementChild.outerHTML.replace("Printer", "");
    }

    function guid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0,
                v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    OCTOPRINT_VIEWMODELS.push([
        BettergrblsupportViewModel,
        ["settingsViewModel", "loginStateViewModel", "accessViewModel"],
        ["#tab_plugin_bettergrblsupport"]
    ]);
});
