// helper for function getEventUid
const uidMapper = {
  mouse: (event) => {
    return `m${event.button}`;
  },
  touch: (event) => {
    return `t${event.targetTouches[0].identifier}`;
  },
  point: (event) => {
    return `p${event.pointerId}`;
  },
};
/** Get the unique event id that persists between down/move/up events. **/
function getEventUid(event) {
  let k = event.type.substr(0, 5);
  if (k in uidMapper) {
    return uidMapper[k](event);
  }
  throw new Error("?!");
}

/**
 * GamePadAxis is to be used by the GamePad class. This handles the math per each unique axis. 
 */ 
class GamePadAxis {
  /**
   * @param label the label for this axis
   * @param minBound (number) the normalized minimum value for this axis.
   * @param maxBound (number) the normalized maximum value for this axis.
   * @param step (Optional<number>) if you want to snap to certain discrete steps. optional step value (1-> round to whole number; 5 -> round to nearest 5's; 0.1 -> round to nearest 10ths place; null -> do not round)
   * @param snapBackVal (Optional<number>) if given, the axis will snap back to this value when not in use.
   */
  constructor(label, minBound = -100, maxBound = 100, step = null, snapBackVal = null) {
    this.label = label;
    this.minBound = parseFloat(minBound);
    this.maxBound = parseFloat(maxBound);
    if (step != null && isFinite(step)) {
      step = parseFloat(step);
      this.step = step;
      this.stepf = (val) => Math.ceil(val / step) * step;
    } else {
      this.stepf = (val) => val;
    }
    if (
      this.minBound != null &&
      this.maxBound != null &&
      (!isFinite(this.minBound) || !isFinite(this.maxBound))
    ) {
      throw new Error("Bounds must be finite");
    }
    this.range = this.maxBound - this.minBound;
    if (this.range < 0) {
      throw new Error(
        `Invalid bounds, must have range greater than or equal to 0`
      );
    }
    if (
      this.step != undefined &&
      this.step > (this.maxBound - this.minBound) / 2.0
    ) {
      throw new Error(
        "step must be less than half of the range between max and min"
      );
    }
    if (snapBackVal != null && isFinite(snapBackVal)) {
      this.snapBackVal = parseFloat(snapBackVal);
      if (
        this.snapBackVal < this.minBound ||
        this.snapBackVal > this.maxBound
      ) {
        throw new Error(
          `defaultVal must be between min and max bounds (inclusive)!`
        );
      }
      this.snapBackVal = this.stepf(this.snapBackVal);
    }
    this.currVal = this.snapBackVal ?? null;
  }

  /** stepf:Optional<Function:number>, function that returns a number rounded to the Optional<step> */
  stepf(value) { return value }

  /**
   * @returns the current value for this axis. 
   * Note: if the axis value was never set/initalized then it defaults to the snapBackVal or the center of the bounds.
   */
  getValue() {
    return (this.currVal ?? this.snapBackVal ?? this.stepf((this.maxBound - this.minBound) / 2));
  }
  
  /**
   * @returns the current value normalized with respect to the range of the axis.
   */
  getValueRelativeToRange() {
    return (this.getValue() - this.minBound) / this.range;
  }

  /**
   * Update this axis value with respect to the axis bounds. This func handles the min/max clamping. Also rounds to the nearest step if applicable.
   * @param percentageOfBounds (number) number between 0 and 1 inclusive, to set the current value with respect to the bounds. 
   *   1 -> this.maxBound; 0 -> this.minBound;
   */
  updateValueRelative(percentageOfBounds) {
    this.updateValueRaw(this.minBound + this.range * percentageOfBounds);
  }

  /**
   * Update this axis value. This func handles the min/max clamping. Also rounds to the nearest step if applicable.
   * @param value (number) the value to set for this axis.
   */
  updateValueRaw(value) {
    this.currVal = Math.min(Math.max(this.minBound, this.stepf(value)), this.maxBound);
  }
}

/**
 * GamePad. Creates a canvas to be controlled with user input.
 */
class GamePad {
  static ActionEnum = {
    ACTIVATE: 1,
    DEACTIVATE: -1,
    MOVE: 0,
  };

  // keep track of all initalized GamePad instances
  static GAMEPADS = {};

  // keep track of all active gamepads in use and the keys being used to move them
  static claimed = {};

  /**
   * @todo: how to set dynamic height?
   * @param width (number) the pixel space width of the canvas
   * @param height (number) the pixel space width of the canvas
   */
  constructor(width = 100, height = 100) {
    if (width <= 0 || height <= 0) {
      throw new Error("Drawn canvas size must be greater than zero!");
    }
    // generate unique id for this gamepad
    this.id = crypto.randomUUID();

    // generate the canvas object
    this.canvas = document.createElement("canvas");
    this.canvas.width = parseInt(width);
    this.canvas.height = parseInt(height);
    this.canvas.id = this.id;
    // Fixing Unable to preventDefault inside passive event listener due to target being treated as passive in Chrome [Thanks to https://github.com/artisticfox8 for this suggestion]
    this.canvas.style.touchAction = "none";

    // setup array of axis to be controlled. 
    this.axes = [];

    // gamepad is actively being controlled/updated
    this.active = false;

    // regsiter under intialized instances
    GamePad.GAMEPADS[this.id] = this;

    // start listener for this object's activate event
    if ("ontouchstart" in document.documentElement) {
      // register touch events for just this canvas
      this.canvas.addEventListener("touchstart", this.activate, false);
    } else if ("PointerEvent" in window) {
      // register pointer events for just this canvas
      this.canvas.addEventListener("pointerdown", this.activate, false);
    }
  }

  destructor() {
    GamePad.GAMEPADS[this.id] = null;
  }

  /**
   * Registers a global input activity to gamepad pairing.
   * This allows for moving pointer/touch outside the canvas element while still only controlling the proper canvas ui.
   * @param event (Event) The event that spawned the activate function.
   */
  #registerActive(event) {
    let aId = getEventUid(event);
    if (GamePad.claimed[aId]) {
      console.error("??? event currently claimed by another gamepad?", GamePad.claimed[aId]);
    }
    console.debug(`${this.id} claiming ${aId}`);
    GamePad.claimed[aId] = this;
  }

  /**
   * Releases the input activity to gamepad pairing.
   * @param event (Event) The event that spawned the deactivate function.
   */
  #releaseActive(event) {
    let aId = getEventUid(event);
    if (GamePad.claimed[aId]) {
      console.debug(`releasing ${aId}`);
      GamePad.claimed[aId] = null;
    } else {
      console.log(`attempted to release illegal event ${aId}`, event, this);
    }
  }

  /**
   * axes are added in the order of: Horizontal/X, Vertical/Y, ... (only handles 2 axes at the moment)
   * @param label the label for this axis
   * @param minBound (number) the normalized minimum value for this axis.
   * @param maxBound (number) the normalized maximum value for this axis.
   * @param step (Optional<number>) if you want to snap to certain discrete steps. optional step value (1-> round to whole number; 5 -> round to nearest 5's; 0.1 -> round to nearest 10ths place; null -> do not round, 0->always zero)
   * @param snapBackVal (Optional<number>) if given, the axis will snap back to this value when not in use.
   */
  addAxis(label, minBound = -100, maxBound = 100, step = null, snapBackVal = null) {
    this.axes.push(new GamePadAxis(label, minBound, maxBound, step, snapBackVal));
  }

  /**
   * Sets the draw shape func, will call the given function and pass the current center of the shape in pixel space coordinates
   * @param canvasShapeFunc (Function) function to call (HTMLCanvasElement, number[])
   * NOTE: it is up to the canvasShapeFunc to not draw the shape out of bounds.
   */
  setDrawShapeFunc(canvasShapeFunc) {
    this.drawShape = canvasShapeFunc;
  }

  /**
   * Sets the update callback function.
   * The given callback will be called with an object where the keys are the axes labels and their respective values.
   * @param func (Function) the function to call when a gamepad value is updated.
   */
  setUpdateCallback(func) {
    this.callback = func;
  }

  /**
   * Enables this canvas to start being used as a gamepad.
   * @param event Event the event that is supposed to activate a gamepad. 
   * Note: this should be bound directly to this.canvas.
   */
  activate(event) {
    if (event.target == GamePad.GAMEPADS[event.target?.id]?.canvas) {
      GamePad.GAMEPADS[event.target.id].active = true;
      write2log(`${event.target.id} active`)
    }
    GamePad.GAMEPADS[event.target.id].#registerActive(event);
  }

  /** 
   * Releases the input action to gamepad mapping, resets the axes if needed, and sends the final callback with the post-snapback state if applicable.
   * @param event Event the event that is supposed to deactivate a gamepad.
   * Note: can be bound to the document DOM. 
   */
  static deactivate(event) {
    // which gamepad are we trying to update
    let aId = getEventUid(event);
    let gamepad;
    if (aId in GamePad.claimed) {
      // if found a pair of gamepad to input action, then release it.
      gamepad = GamePad.claimed[aId];
      gamepad.#releaseActive(event);
      delete GamePad.claimed[aId];
      write2log(`${aId} inactive`)
    }
    if (gamepad) {
      gamepad.active = false;
      let callbackArgs = {};
      // generate callback args
      gamepad.axes.forEach((axis) => {
        // snapback if needed in this loop for efficency
        if (axis.snapBackVal != null) {
          axis.updateValueRaw(axis.snapBackVal);
        }
        callbackArgs[axis.label] = axis.getValue();
        callbackArgs[`_rel_pixel_${axis.label}`] =
          axis.getValueRelativeToRange();
      });
      // clear gamepad canvas so we can redraw.
      gamepad.canvas
        .getContext("2d")
        .clearRect(0, 0, gamepad.canvas.width, gamepad.canvas.height);
      // call the functions
      gamepad.drawShape(callbackArgs);
      if (gamepad.callback) {
        gamepad.callback(callbackArgs);
      }
    }
  }

  /**
   * Draws the updated canvas, updates the axis values, and calls the callback for the updated axis mapping.
   * Note: can be bound to the document DOM. 
   */
  static drawAndUpdate(event) {
    let aId = getEventUid(event);
    let gamepad = GamePad.claimed[aId];
    if (gamepad?.active) {
      write2log(aid, 1)
      // only supports 2d canvases at the moment
      const rect = gamepad.canvas.getBoundingClientRect();
      let xPxRel = event.clientX - rect.left;
      let yPxRel = event.clientY - rect.top;
      // update axis values
      gamepad.axes[0].updateValueRelative(xPxRel / gamepad.canvas.width);
      gamepad.axes[1].updateValueRelative(yPxRel / gamepad.canvas.height);
      // call the set callback with the updated axis values
      let callbackArgs = {};
      gamepad.axes.forEach((axis) => {
        callbackArgs[axis.label] = axis.getValue();
        callbackArgs[`_rel_pixel_${axis.label}`] =
          axis.getValueRelativeToRange();
      });
      // update drawing
      gamepad.canvas
        .getContext("2d")
        .clearRect(0, 0, gamepad.canvas.width, gamepad.canvas.height);
      gamepad.drawShape(callbackArgs);
      if (gamepad.callback && event.isTrusted) {
        // dont callback when the event was not spawned by human. its likely its a sync update call
        gamepad.callback(callbackArgs);
      }
    }
  }

  /**
   * Register the event listeners depending on the device's features. 
   * Will enable touch xor pointer.
   * Note: should be called once. Should be called when loading the script, before you want to use the gamepads.
   */
  static addDocumentEventListeners() {
    // when loading the script, enable the features
    if ("ontouchstart" in document.documentElement) {
      // register touch events
      document.addEventListener("touchend", GamePad.deactivate, false);
      document.addEventListener("touchcancel", GamePad.deactivate, false);
      document.addEventListener("touchmove", GamePad.drawAndUpdate, false);
    } else if ("PointerEvent" in window) {
      // register pointer events
      document.addEventListener("pointerup", GamePad.deactivate, false);
      document.addEventListener("pointercancel", GamePad.deactivate, false);
      document.addEventListener("pointermove", GamePad.drawAndUpdate, false);
    } 
    // todo: do we need to register mouse events or does pointer cover that as well?
  }
}

// sample for enabling event liseners.
// window.addEventListener("load", GamePad.addDocumentEventListeners, false);
