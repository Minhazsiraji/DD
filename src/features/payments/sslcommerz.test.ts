import { describe,expect,it } from "vitest";
import { createPayment,normalizeStatus,validatePayment,type SslCommerzTransport } from "./sslcommerz";
const env={SSLCOMMERZ_PRACTICE_STORE_ID:"sandbox-store",SSLCOMMERZ_PRACTICE_STORE_PASSWORD:"secret"};
const input={transactionId:"DDP-1",amount:"500.00",currency:"BDT" as const,successUrl:"https://x/s",failUrl:"https://x/f",cancelUrl:"https://x/c",ipnUrl:"https://x/i",customerName:"Test",customerEmail:"test@example.com",customerPhone:"01700000000",productName:"Consultation"};
describe("SSLCOMMERZ sandbox adapter",()=>{
 it("fails safely without credentials",async()=>{await expect(createPayment(input,{postForm:async()=>({}),getJson:async()=>({})},{})).rejects.toThrow("NOT_CONFIGURED")});
 it("constructs session request and accepts GatewayPageURL",async()=>{let captured:URLSearchParams|undefined; const t:SslCommerzTransport={postForm:async(_u,b)=>{captured=b;return{GatewayPageURL:"https://sandbox.sslcommerz.com/EasyCheckOut/test"}},getJson:async()=>({})}; expect((await createPayment(input,t,env)).gatewayPageUrl).toMatch(/^https:/); expect(captured?.get("tran_id")).toBe("DDP-1"); expect(captured?.get("total_amount")).toBe("500.00")});
 it("normalizes provider states",()=>{expect(normalizeStatus("VALID")).toBe("VALID");expect(normalizeStatus("VALIDATED")).toBe("VALIDATED");expect(normalizeStatus("FAILED")).toBe("FAILED");expect(normalizeStatus("CANCELLED")).toBe("CANCELLED");expect(normalizeStatus("x")).toBe("UNKNOWN")});
 it("validates authoritative fields",async()=>{const t:SslCommerzTransport={postForm:async()=>({}),getJson:async()=>({status:"VALID",tran_id:"DDP-1",bank_tran_id:"BANK1",amount:"500.00",currency:"BDT",card_type:"BKASH"})}; expect(await validatePayment("VAL1",t,env)).toMatchObject({ok:true,transactionId:"DDP-1",providerTransactionId:"BANK1",amount:"500.00",currency:"BDT",cardType:"BKASH"})});
 it("rejects failed validation",async()=>{const t:SslCommerzTransport={postForm:async()=>({}),getJson:async()=>({status:"FAILED",tran_id:"DDP-1",amount:"500.00",currency:"BDT"})}; expect((await validatePayment("VAL2",t,env)).ok).toBe(false)});
 it("surfaces provider network errors",async()=>{const t:SslCommerzTransport={postForm:async()=>{throw new Error("network")},getJson:async()=>({})}; await expect(createPayment(input,t,env)).rejects.toThrow("network")});
});
