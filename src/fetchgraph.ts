import { gql, request } from 'graphql-request';
import dotenv from 'dotenv';
dotenv.config();

const url: string = process.env.SUBGRAPH_URL || '';

if (!url) {
  throw new Error('SUBGRAPH_URL environment variable is not defined.');
}


const baseQuery = gql`
  query fetchRecentRegistrations($targetTimestamp: BigInt!, $skip: Int!) {
    nameRegistereds(
      where: { blockTimestamp_gte: $targetTimestamp }
      orderBy: blockNumber
      orderDirection: desc
      first: 100
      skip: $skip
    ) {
      id
      name
      owner
      transactionHash
      blockNumber
      blockTimestamp
    }
  }
`;
// use this for computing totals
const slimQuery = gql`
  query fetchRecentRegistrationIds($targetTimestamp: BigInt!, $skip: Int!) {
    nameRegistereds(
      where: { blockTimestamp_gte: $targetTimestamp }
      orderBy: blockNumber
      orderDirection: desc
      first: 100
      skip: $skip
    ) {
      id
    }
  }
`;

async function fetchsubgraph(hours: number) {
  try {
    const timePeriod = hours * 60 * 60 * 1000;
    const targetTimestamp = Math.floor((Date.now() - timePeriod) / 1000); // Convert to seconds

    let skip = 0;
    const results: any = [];
    let hasMore = true;

    console.log(`Started fetching at ${new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })}`)
    
    while (hasMore) {
      const data: any = await request(url, baseQuery, { targetTimestamp, skip });
      const nameRegistereds = data.nameRegistereds;
      results.push(...nameRegistereds);
      
      console.log(`Fetched ${nameRegistereds.length} items at skip ${skip}`);

      if (nameRegistereds.length < 100) {
        hasMore = false; // No more data to fetch
      } else {
        skip += 100; // Fetch next page
      }
    }

    console.log('Fetched data length:', results.length);
    return results;

  } catch (error) {
    if (error instanceof Error) {
      console.error("Error fetching subgraph data: ", error.message);
    } else {
      console.error("Unknown error: ", error);
    }
  }
}


async function fetchRegistrationCount(hours: number) {
  try {
    const timePeriod = hours * 60 * 60 * 1000;
    const targetTimestamp = Math.floor((Date.now() - timePeriod) / 1000); // Convert to seconds

    let skip = 0;
    let count = 0;
    let hasMore = true;

    console.log(`Started fetching at ${new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })}`);

    while (hasMore) {
      const data: any = await request(url, slimQuery, { targetTimestamp, skip });
      const nameRegistereds = data.nameRegistereds;
      count += nameRegistereds.length;

      console.log(`Fetched ${nameRegistereds.length} items at skip ${skip}`);

      if (nameRegistereds.length < 100) {
        hasMore = false; // No more data to fetch
      } else {
        skip += 100; // Fetch next page
      }
    }

    console.log('Total registrations:', count);
    return count;
  } catch (error) {
    console.error("Error fetching registration count:", error);
    return 0;
  }
}


export { fetchsubgraph }
export { fetchRegistrationCount }