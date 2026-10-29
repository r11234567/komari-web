export {workspaceCredentialResource} from '../../src/api/connect/trustedCredential';
export const credentialCalls: {method:string;request:unknown}[]=[];
export const trustedCredentialClient={
 async listTrustedCredentialProviders(request:unknown) {
  credentialCalls.push({method:'providers',request});
  return {providers:[{id:'email',displayName:'Email OTP'},{id:'passkey',displayName:'Passkey'}]};
 },
 async beginVerification(request:unknown) {
  credentialCalls.push({method:'begin',request});
  return {challengeId:'synthetic-challenge',promptType:'otp',prompt:{length:8,charset:"alphanumeric"}};
 },
 async completeVerification(request:unknown) {
  credentialCalls.push({method:'complete',request});
  return {authorization:{grantToken:'synthetic-scoped-proof'}};
 },
 async cancelVerification(request:unknown) {credentialCalls.push({method:'cancel',request});return {};}
};
