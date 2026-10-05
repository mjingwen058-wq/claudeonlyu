// 展期时钟：快变量按真实秒走；慢变量（小时、天）按展期时间走。
// 演示加速时，真实 1 秒 = 展期 1 分钟，一天（10:00–18:00）大约 8 分钟走完。

export const OPEN_MIN = 10 * 60;
export const CLOSE_MIN = 18 * 60;

export class Clock {
  constructor() {
    this.day = 1;
    this.minutes = OPEN_MIN;
    this.speed = 1; // 1 = 实时，60 = 演示加速
    this.real = 0; // 页面启动以来的真实秒数
  }
  // 返回这一帧对应的展期秒数
  advance(dtReal) {
    this.real += dtReal;
    const dtExhibit = dtReal * this.speed;
    this.minutes += dtExhibit / 60;
    return dtExhibit;
  }
  get pastClosing() {
    return this.minutes >= CLOSE_MIN;
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
