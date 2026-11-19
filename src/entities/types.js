'use strict';
/* 实体接口（只有类型说明，没有实现）。详见 docs/ENTITIES.md。
 *
 * @typedef {Object} Entity
 * @property {number} id
 * @property {string} kind
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} hp
 * @property {Object} data
 *
 * @typedef {Object} EntityKind
 * @property {string} kind
 * @property {(e: Entity, ctx: EntityContext) => void} update
 * @property {(e: Entity, ev: Object, ctx: EntityContext) => void} [onEvent]
 * @property {(e: Entity, g: CanvasRenderingContext2D, cell: number) => void} [draw]
 *
 * @typedef {Object} EntityContext
 * @property {Object} world
 * @property {(cmd: string, args: Object) => any} exec
 * @property {() => number} rand
 * @property {EntitySystem} system
 *
 * @typedef {Object} EntitySystem
 * @property {(kind: string, x: number, y: number, data?: Object) => Entity} spawn
 * @property {(id: number) => void} remove
 * @property {(step: number) => void} update
 * @property {(ev: Object) => void} onEvent
 * @property {(x: number, y: number, r: number) => Entity[]} near
 * @property {() => Object} serialize
 * @property {(o: Object) => void} deserialize
 */
export const ENTITY_INTERFACE_VERSION = 0;
