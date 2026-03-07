declare module "react-timeago" {
  import { Component } from "react";

  export interface TimeAgoProps {
    date: string | number | Date;
    live?: boolean;
    minPeriod?: number;
    maxPeriod?: number;
    formatter?: (value: number, unit: string, suffix: string) => string;
    component?: string | Component;
    title?: string;
    [key: string]: unknown;
  }

  export default class TimeAgo extends Component<TimeAgoProps> {}
}
