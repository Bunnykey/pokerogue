// Phaser.Class polyfill for Node.js/headless mode.
// Rex plugins reference global Phaser.Class at module load time.
// Phaser 3's ESM export doesn't include Class (it's internal).
// This is extracted from Phaser's source (klasse library, MIT licensed).

function hasGetterOrSetter(def: any): boolean {
  return (!!def.get && typeof def.get === "function") || (!!def.set && typeof def.set === "function");
}

function getProperty(definition: any, k: string, isClassDescriptor: boolean): any {
  const def = isClassDescriptor ? definition[k] : Object.getOwnPropertyDescriptor(definition, k);
  const resolved = !isClassDescriptor && def?.value && typeof def.value === "object" ? def.value : def;
  if (resolved && hasGetterOrSetter(resolved)) {
    if (typeof resolved.enumerable === "undefined") {
      resolved.enumerable = true;
    }
    if (typeof resolved.configurable === "undefined") {
      resolved.configurable = true;
    }
    return resolved;
  }
  return false;
}

function extend(ctor: any, definition: any, isClassDescriptor?: boolean, parent?: any) {
  for (const k in definition) {
    if (!Object.hasOwn(definition, k)) {
      continue;
    }
    const def = getProperty(definition, k, !!isClassDescriptor);
    if (def !== false) {
      const p = parent || ctor;
      const prop = Object.getOwnPropertyDescriptor(p.prototype, k);
      if (prop && prop.configurable === false) {
        if (PhaserClass.ignoreFinals) {
          continue;
        }
        throw new Error("cannot override final property '" + k + "'");
      }
      Object.defineProperty(ctor.prototype, k, def);
    } else {
      ctor.prototype[k] = definition[k];
    }
  }
}

function mixin(myClass: any, mixins: any) {
  if (!mixins) {
    return;
  }
  if (!Array.isArray(mixins)) {
    mixins = [mixins];
  }
  for (const m of mixins) {
    extend(myClass, m.prototype || m);
  }
}

function PhaserClass(definition: any) {
  if (!definition) {
    definition = {};
  }
  let initialize: any;
  let Extends: any;

  if (definition.initialize) {
    if (typeof definition.initialize !== "function") {
      throw new Error("initialize must be a function");
    }
    initialize = definition.initialize;
    definition.initialize = undefined;
  } else if (definition.Extends) {
    const base = definition.Extends;
    initialize = function (this: any, ...args: any[]) {
      base.apply(this, args);
    };
  } else {
    initialize = () => {};
  }

  if (definition.Extends) {
    initialize.prototype = Object.create(definition.Extends.prototype);
    initialize.prototype.constructor = initialize;
    Extends = definition.Extends;
    definition.Extends = undefined;
  } else {
    initialize.prototype.constructor = initialize;
  }

  let mixinsDef: any = null;
  if (definition.Mixins) {
    mixinsDef = definition.Mixins;
    definition.Mixins = undefined;
  }

  mixin(initialize, mixinsDef);
  extend(initialize, definition, true, Extends);
  return initialize;
}

PhaserClass.extend = extend;
PhaserClass.mixin = mixin;
PhaserClass.ignoreFinals = false;

export function installPhaserClassPolyfill(Phaser: any): void {
  if (!Phaser.Class) {
    Phaser.Class = PhaserClass;
  }
}
