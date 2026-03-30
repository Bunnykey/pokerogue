import type { MockTextureManager } from "#test/mocks/mock-texture-manager";
import { MockGraphics } from "#test/mocks/mocks-container/mock-graphics";

export class MockGameObjectCreator {
  private readonly textureManager: MockTextureManager;

  constructor(textureManager: MockTextureManager) {
    console.log("Mocking Phaser.GameObjects.GameObjectCreator;");
    this.textureManager = textureManager;
  }

  image(_config?: any) {
    return this.textureManager.add.image(0, 0, "");
  }

  graphics(config: any) {
    return new MockGraphics(this.textureManager, config);
  }

  rexTransitionImagePack() {
    return {
      transit: () => null,
      once: () => null,
    };
  }
}
