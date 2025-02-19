export interface ILogger {
    /**
     * A logger element
     */
    readonly element: HTMLDivElement;
  
    /**
     * Works as console.log and updates a log message on a logger element
     */
    log(...msg: any[]): void;
  
    /**
     * Works as console.warn and updates a log message on a logger element
     */
    warn(...msg: any[]): void;
  
    /**
     * Works as console.error and updates a log message on a logger element
     */
    error(...msg: any[]): void;
    
  }