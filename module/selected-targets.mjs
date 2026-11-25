// Somente marcação explícita com T define alvos de habilidades.
// Um token controlado por clique não é alvo.
export function selectedExternalTokens(_source=null){
 return [...new Map([...(game.user?.targets??[])].map(token=>[token.id,token])).values()];
}
