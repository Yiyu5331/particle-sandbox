'use strict';
/* 元系统接口（只有类型说明，没有实现）。见 src/meta/README.md。
 *
 * @typedef {Object} Achievement
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {(ev: {type: string, [k: string]: any}, stats: Object) => boolean} test   收到总线消息时判定是否达成
 *
 * @typedef {Object} MetaStore
 * @property {(bus: Object) => void} attach                  订阅 game.bus
 * @property {() => Object} stats                            累计统计（爆炸次数、倒塌格数、各模式通关……）
 * @property {(id: string) => boolean} unlocked
 * @property {(id: string) => void} unlock
 * @property {() => Achievement[]} achievements
 * @property {() => Object} serialize
 * @property {(o: Object) => void} deserialize
 */
export const META_INTERFACE_VERSION = 0;
