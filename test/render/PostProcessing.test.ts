import { describe, expect, it } from "vitest";
import { readPostSettings } from "../../src/render/PostProcessing";

describe("PostProcessing — parâmetros da URL", () => {
	it("ligado em qualidade média por padrão; ?post=0 desliga; qualidade inválida cai na média", () => {
		expect(readPostSettings("")).toEqual({ enabled: true, quality: "media" });
		expect(readPostSettings("?post=0")).toEqual({ enabled: false, quality: "media" });
		expect(readPostSettings("?quality=alta")).toEqual({ enabled: true, quality: "alta" });
		expect(readPostSettings("?quality=baixa&post=1")).toEqual({ enabled: true, quality: "baixa" });
		expect(readPostSettings("?quality=ultra")).toEqual({ enabled: true, quality: "media" });
	});
});
