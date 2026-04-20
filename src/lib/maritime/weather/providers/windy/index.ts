/**
 * Windy API provider — STUB.
 *
 * Planned for v1.5. Wraps the commercial Windy Map Forecast API
 * (~€2 000/year) behind the same `WeatherProvider` interface so
 * clients can swap to it with one env var:
 *
 *     NEXT_PUBLIC_WEATHER_PROVIDER=windy
 *     NEXT_PUBLIC_WINDY_API_KEY=...
 *
 * Every method throws `NOT_IMPLEMENTED` until that work lands. The
 * factory in `hooks/use-weather-provider.ts` won't instantiate this
 * class unless explicitly asked, so the stub doesn't hurt anyone by
 * existing.
 */

import type { WeatherProvider } from "../../provider";
import type {
  BracketFrames,
  TimeRange,
  WeatherFrame,
  WeatherType,
} from "../../types";

const NOT_IMPLEMENTED = new Error(
  "WindyWeatherProvider is planned for v1.5 and not yet implemented. " +
    "Set NEXT_PUBLIC_WEATHER_PROVIDER=nefgo in the meantime.",
);

export class WindyWeatherProvider implements WeatherProvider {
  readonly name = "windy";

  async getLatestCycleTime(): Promise<Date | null> {
    throw NOT_IMPLEMENTED;
  }

  async getAvailableRange(_type: WeatherType): Promise<TimeRange> {
    throw NOT_IMPLEMENTED;
  }

  async getFrameTimes(_type: WeatherType): Promise<Date[]> {
    throw NOT_IMPLEMENTED;
  }

  async getFrame(_type: WeatherType, _time: Date): Promise<WeatherFrame> {
    throw NOT_IMPLEMENTED;
  }

  async getBracketingFrames(
    _type: WeatherType,
    _time: Date,
  ): Promise<BracketFrames> {
    throw NOT_IMPLEMENTED;
  }
}
