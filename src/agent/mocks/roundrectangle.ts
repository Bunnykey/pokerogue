// Mock RoundRectangle for headless mode
import { MockContainer } from "#test/mocks/mocks-container/mock-container";
export default class RoundRectangle extends (MockContainer as any) {
  constructor(..._args: any[]) {
    super(null as any, 0, 0);
  }
}
