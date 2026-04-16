export const formatInterestRate = (interestRate: number): number => {

    const formattedRate = interestRate * 100;
    return formattedRate // Convert from basis points to percentage
}



export const convertbasisPointsToPercentage = (interestRate: number): number => {
    const formattedRate = interestRate / 100; // Convert from basis points to percentage
    return formattedRate // Format to 2 decimal places
}