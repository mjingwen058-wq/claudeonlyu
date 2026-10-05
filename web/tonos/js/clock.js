// 展期时钟：快变量按真实秒走；慢变量（小时、天）按展期时间走。
// 平时是真实时间（北京时间），它的一天就是真实的一天；
// 演示加速时（沙盒），真实 1 秒 = 展期 1 分钟，一天（10:00–18:00）大约 8 分钟走完。

export const OPEN_MIN = 10 * 60;
export const CLOSE_MIN = 18 * 60;

export class Clock {
  constructor() {
    this.day = 1;
    this.minutes = OPEN_MIN;
    this.speed = 1; // 1 = 实时，60 = 演示加速
    this.real = 0; // 页面启动以来的真实秒数
    this.realtime = false;
  }
  // 切到真实时间：第 day 天，时刻跟着北京时间走
  setReal(day) {
    this.realtime = true;
    this.speed = 1;
    this.day = day;
    this.syncReal();
  }
  syncReal() {
    const d = new Date(Date.now() + 8 * 3600e3);
    this.minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  }
  // 返回这一帧对应的展期秒数
  advance(dtReal) {
    this.real += dtReal;
    if (this.realtime) {
      this.syncReal();
      return dtReal;
    }
    const dtExhibit = dtReal * this.speed;
    this.minutes += dtExhibit / 60;
    return dtExhibit;
  }
  get pastClosing() {
    return !this.realtime && this.minutes >= CLOSE_MIN;
  }
  nextDay() {
    this.day += 1;
    this.minutes = OPEN_MIN;
  }
  label() {
    const m = Math.floor(this.minutes);
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `D${this.day} ${hh}:${mm}`;
  }
  // 当天开馆进度 0–1
  get dayProgress() {
    return Math.min(1, (this.minutes - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN));
  }
}
