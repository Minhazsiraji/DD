import "server-only";

export type SslCommerzStatus = "VALID" | "VALIDATED" | "FAILED" | "CANCELLED" | "UNKNOWN";
export interface SslCommerzConfig { storeId:string; storePassword:string; baseUrl:string; validationUrl:string }
export interface CreatePaymentInput { transactionId:string; amount:string; currency:"BDT"; successUrl:string; failUrl:string; cancelUrl:string; ipnUrl:string; customerName:string; customerEmail:string; customerPhone:string; productName:string }
export interface ValidationResult { ok:boolean; status:SslCommerzStatus; transactionId:string; providerTransactionId:string|null; amount:string|null; currency:string|null; cardType:string|null; rawStatus:string|null }
export interface SslCommerzTransport { postForm(url:string, body:URLSearchParams):Promise<unknown>; getJson(url:string):Promise<unknown> }

const fetchTransport:SslCommerzTransport = {
  async postForm(url,body){ const r=await fetch(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body,cache:"no-store"}); if(!r.ok) throw new Error("SSLCOMMERZ_NETWORK_ERROR"); return r.json(); },
  async getJson(url){ const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error("SSLCOMMERZ_NETWORK_ERROR"); return r.json(); },
};

export function sslCommerzConfig(env:Record<string,string|undefined>=process.env):SslCommerzConfig|null {
  const storeId=env.SSLCOMMERZ_PRACTICE_STORE_ID?.trim(), storePassword=env.SSLCOMMERZ_PRACTICE_STORE_PASSWORD?.trim();
  if(!storeId||!storePassword) return null;
  return {storeId,storePassword,baseUrl:"https://sandbox.sslcommerz.com/gwprocess/v4/api.php",validationUrl:"https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"};
}
export function normalizeStatus(value:unknown):SslCommerzStatus { const s=String(value??"").trim().toUpperCase(); if(s==="VALID"||s==="VALIDATED") return s; if(s==="FAILED"||s==="FAIL") return "FAILED"; if(s==="CANCELLED"||s==="CANCELED") return "CANCELLED"; return "UNKNOWN"; }
function record(v:unknown):Record<string,unknown>{ return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{}; }

export async function createPayment(input:CreatePaymentInput, transport:SslCommerzTransport=fetchTransport, env:Record<string,string|undefined>=process.env):Promise<{gatewayPageUrl:string}>{
  const c=sslCommerzConfig(env); if(!c) throw new Error("SSLCOMMERZ_PRACTICE_SANDBOX_NOT_CONFIGURED");
  const body=new URLSearchParams({store_id:c.storeId,store_passwd:c.storePassword,total_amount:input.amount,currency:input.currency,tran_id:input.transactionId,success_url:input.successUrl,fail_url:input.failUrl,cancel_url:input.cancelUrl,ipn_url:input.ipnUrl,cus_name:input.customerName,cus_email:input.customerEmail,cus_phone:input.customerPhone,cus_add1:"Bangladesh",cus_city:"Dhaka",cus_country:"Bangladesh",shipping_method:"NO",product_name:input.productName,product_category:"Healthcare",product_profile:"general"});
  const data=record(await transport.postForm(c.baseUrl,body)); const gatewayPageUrl=typeof data.GatewayPageURL==="string"?data.GatewayPageURL.trim():"";
  if(!gatewayPageUrl||!/^https:\/\//i.test(gatewayPageUrl)) throw new Error("SSLCOMMERZ_SESSION_INVALID"); return {gatewayPageUrl};
}

export async function validatePayment(validationId:string, transport:SslCommerzTransport=fetchTransport, env:Record<string,string|undefined>=process.env):Promise<ValidationResult>{
  const c=sslCommerzConfig(env); if(!c) throw new Error("SSLCOMMERZ_PRACTICE_SANDBOX_NOT_CONFIGURED"); const url=new URL(c.validationUrl);
  url.searchParams.set("val_id",validationId); url.searchParams.set("store_id",c.storeId); url.searchParams.set("store_passwd",c.storePassword); url.searchParams.set("format","json");
  const d=record(await transport.getJson(url.toString())), status=normalizeStatus(d.status);
  return {ok:status==="VALID"||status==="VALIDATED",status,transactionId:String(d.tran_id??""),providerTransactionId:d.bank_tran_id?String(d.bank_tran_id):null,amount:d.amount?String(d.amount):null,currency:d.currency?String(d.currency):null,cardType:d.card_type?String(d.card_type):null,rawStatus:d.status?String(d.status):null};
}
